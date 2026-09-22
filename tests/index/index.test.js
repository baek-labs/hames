"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {buildIndexPlan,syncIndexes,auditIndexes}=require("../../src/runtime/index.js");
const {checkFile}=require("../../src/runtime/rules.js");
function fixture(t) {
 const base=path.resolve(__dirname,"../.tmp");fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,"index-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspaces=[{version:2,id:"work",path:"회사 업무",name:"Work",purpose:"Work files",folders:[{path:"회의록",purpose:"Minutes"}],rules:[{id:"markdown",kind:"extension",path:"회의록",value:[".md"]}],exclude:[],context:[],protect:[]}];
 const project={root,config:{version:2,documents:[],exclude:[]},workspaces};
 fs.mkdirSync(path.join(root,"회사 업무/회의록"),{recursive:true});fs.mkdirSync(path.join(root,"docs"));
 return {root,project};
}
test("preview is read-only, indexes files and nested folders, audit does not repair",t=>{
 const {root,project}=fixture(t);fs.writeFileSync(path.join(root,"회사 업무/회의록/회의.md"),"# Meeting\n");
 const ops=buildIndexPlan(root,{project});assert.ok(ops.some(o=>o.path==="회사 업무/회의록/_Index.md"));
 assert.equal(fs.existsSync(path.join(root,"_Index.md")),false);
 assert.ok(auditIndexes(root,{project}).issues.some(i=>i.rule==="missing_index"));
 assert.equal(syncIndexes(root,{project}).ok,true);
 assert.equal(auditIndexes(root,{project}).issues.filter(i=>i.status==="violation").length,0);
 fs.writeFileSync(path.join(root,"회사 업무/회의록/new.md"),"New");
 const before=fs.readFileSync(path.join(root,"회사 업무/회의록/_Index.md"),"utf8");
 assert.ok(auditIndexes(root,{project}).issues.some(i=>i.rule==="unlisted_file"));
 assert.equal(fs.readFileSync(path.join(root,"회사 업무/회의록/_Index.md"),"utf8"),before);
});
test("managed index updates preserve prose and manual links; duplicate events are idempotent",t=>{
 const {root,project}=fixture(t);const dir=path.join(root,"회사 업무/회의록");
 fs.writeFileSync(path.join(dir,"one.md"),"One");fs.writeFileSync(path.join(dir,"_Index.md"),"# My notes\n[One](./one.md)\nKeep this.\n");
 assert.equal(syncIndexes(root,{project}).ok,true);
 const first=fs.readFileSync(path.join(dir,"_Index.md"),"utf8");assert.equal((first.match(/one\.md/g)||[]).length,1);assert.match(first,/Keep this/);
 assert.equal(syncIndexes(root,{project}).ok,true);assert.equal(fs.readFileSync(path.join(dir,"_Index.md"),"utf8"),first);
 fs.renameSync(path.join(dir,"one.md"),path.join(dir,"two.md"));syncIndexes(root,{project,paths:["회사 업무/회의록/one.md","회사 업무/회의록/two.md"]});
 assert.match(fs.readFileSync(path.join(dir,"_Index.md"),"utf8"),/two\.md/);
 assert.ok(auditIndexes(root,{project}).issues.some(i=>i.rule==="broken_link"));
});
test("nested owners, excluded secrets and symlinks do not leak into indexes",t=>{
 const {root,project}=fixture(t);project.workspaces.push({version:2,id:"child",path:"회사 업무/회의록",purpose:"Child",folders:[],rules:[]});
 fs.writeFileSync(path.join(root,"회사 업무/.env"),"SECRET=not-an-index-entry");
 fs.symlinkSync(root,path.join(root,"회사 업무/cycle"));syncIndexes(root,{project});
 const a=auditIndexes(root,{project});assert.ok(a.excluded.some(e=>e.path.endsWith(".env")));assert.ok(a.issues.some(e=>e.rule==="symlink"));
 assert.doesNotMatch(fs.readFileSync(path.join(root,"회사 업무/_Index.md"),"utf8"),/SECRET|\.env/);
});
test("definite rule violations and semantic uncertainty are separate",t=>{
 const {project}=fixture(t);
 assert.ok(checkFile(project,"회사 업무/회의록/no.txt").some(i=>i.status==="violation"));
 project.workspaces[0].rules.push({id:"topic",kind:"semantic",path:".",value:"Work related only"});
 assert.ok(checkFile(project,"회사 업무/회의록/yes.md").some(i=>i.status==="needs_judgment"));
 assert.equal(checkFile(project,"docs/common.md").length,0);
 assert.ok(checkFile(project,"unknown/file.md").some(i=>i.rule==="unregistered_location"));
});
test("failed index update preserves user file and records recovery for a successful retry",t=>{
 const {root,project}=fixture(t);const user=path.join(root,"회사 업무/report.md");fs.writeFileSync(user,"Keep");
 const result=syncIndexes(root,{project,failAfter:1});assert.equal(result.ok,false);assert.equal(fs.readFileSync(user,"utf8"),"Keep");
 assert.ok(fs.existsSync(path.join(root,".hames/state/index-pending.json")));
 assert.equal(syncIndexes(root,{project}).ok,true);assert.equal(fs.existsSync(path.join(root,".hames/state/index-pending.json")),false);
});

test("concurrent manual edits and a busy writer never get overwritten",t=>{
 const {root,project}=fixture(t);syncIndexes(root,{project});fs.writeFileSync(path.join(root,"회사 업무/report.md"),"New");
 const file=path.join(root,"회사 업무/_Index.md");let edited=false;
 const result=syncIndexes(root,{project,beforeWrite(o){if(!edited&&o.path==="회사 업무/_Index.md"){edited=true;fs.appendFileSync(file,"\nManual concurrent edit\n");}}});
 assert.equal(result.ok,false);assert.match(fs.readFileSync(file,"utf8"),/Manual concurrent edit/);
 const lock=path.join(root,".hames/state/index.lock");fs.writeFileSync(lock,"active writer");
 assert.equal(syncIndexes(root,{project}).ok,false);assert.equal(fs.readFileSync(lock,"utf8"),"active writer");fs.unlinkSync(lock);
 assert.equal(syncIndexes(root,{project}).ok,true);assert.match(fs.readFileSync(file,"utf8"),/Manual concurrent edit/);
});

test("an approved repair preview cannot absorb a later file change",t=>{
 const {root,project}=fixture(t);const {planHash}=require("../../src/runtime/index.js");
 const hash=planHash(buildIndexPlan(root,{project}));fs.writeFileSync(path.join(root,"회사 업무/later.md"),"Later");
 const result=syncIndexes(root,{project,expectedPlanHash:hash});assert.equal(result.ok,false);assert.match(result.reason,/preview changed/);
 assert.equal(fs.existsSync(path.join(root,"_Index.md")),false);
});

test("ordinary synchronization never recreates a deleted workspace",t=>{
 const {root,project}=fixture(t);fs.rmSync(path.join(root,"회사 업무"),{recursive:true});
 const result=syncIndexes(root,{project});assert.equal(result.ok,false);
 assert.equal(fs.existsSync(path.join(root,"회사 업무")),false);
 const ops=buildIndexPlan(root,{project,extraDirectories:["회사 업무","회사 업무/회의록"]});
 assert.ok(ops.some(o=>o.path==="회사 업무/회의록/_Index.md"));
});

test("two independent writers retain both files in the final index",async t=>{
 const {root,project}=fixture(t);syncIndexes(root,{project});const {spawn}=require("node:child_process");
 const script="const fs=require('node:fs'),p=require('node:path');const project=JSON.parse(process.argv[1]);fs.writeFileSync(p.join(project.root,process.argv[2]),'created');const r=require(process.argv[3]).syncIndexes(project.root,{project,paths:[process.argv[2]]});process.exit(r.ok?0:1)";
 const run=name=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,["-e",script,JSON.stringify(project),name,path.resolve(__dirname,"../../src/runtime/index.js")]);let err="";child.stderr.on("data",d=>err+=d);child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(err||`writer exit ${code}`)));});
 await Promise.all([run("회사 업무/a.md"),run("회사 업무/b.md")]);
 const text=fs.readFileSync(path.join(root,"회사 업무/_Index.md"),"utf8");assert.match(text,/a\.md/);assert.match(text,/b\.md/);
 assert.equal(auditIndexes(root,{project}).issues.filter(i=>i.status==="violation").length,0);
});
