#!/usr/bin/env node
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {loadProject,insideRoot,isRelative}=require("./workspace.js");
const {issue,isUnder,excluded,roleFor,checkFile}=require("./rules.js");
const START="<!-- HAMES:INDEX:START -->", END="<!-- HAMES:INDEX:END -->";
function normalize(relative){return relative.split(path.sep).join("/")||".";}
function readIndex(root,file){const p=insideRoot(root,file);return fs.existsSync(p)?fs.readFileSync(p,"utf8"):null;}
function unmanaged(text) {
 const s=text.indexOf(START),e=text.indexOf(END);
 if(s<0&&e<0)return text;
 if(s<0||e<s||text.indexOf(START,s+START.length)>=0||text.indexOf(END,e+END.length)>=0)throw new Error("Index management markers are damaged or duplicated.");
 return text.slice(0,s)+text.slice(e+END.length);
}
function links(text,dir) {
 const out=[];
 for(const m of text.matchAll(/\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)|\[\[([^\]\n]+)\]\]/g)) {
  let raw=m[1]||m[2].split("|")[0];if(/^(?:[a-z]+:|#)/i.test(raw))continue;
  try{raw=decodeURIComponent(raw.split("#")[0]);}catch{out.push({raw,path:null});continue;}
  const resolved=path.posix.normalize(path.posix.join(dir,raw));
  out.push({raw,path:isRelative(resolved)?resolved:null,wiki:Boolean(m[2])});
 }
 return out;
}
function resolveLink(root,link) {
 if(!link.path)return null;
 const choices=link.wiki?[link.path,link.path+".md",link.raw,link.raw+".md"]:[link.path];
 for(const p of choices){if(!isRelative(p))continue;try{if(fs.existsSync(insideRoot(root,p)))return p;}catch{}}
 return link.path;
}
function inventory(root,{project=loadProject(root),extraDirectories=[]}={}) {
 const directories=new Map([[".",[]]]),issues=[],skipped=[];
 const known=new Set();
 const virtual=new Set(extraDirectories);
 for(const d of extraDirectories){let p=d;while(p!=="."){p=path.posix.dirname(p);virtual.add(p);}}
 function addDir(dir){if(!directories.has(dir))directories.set(dir,[]);}
 function addEntry(dir,entry){addDir(dir);if(!directories.get(dir).some(e=>e.path===entry.path))directories.get(dir).push(entry);}
 function walk(dir) {
  if(known.has(dir))return;known.add(dir);addDir(dir);
  let entries;try{entries=fs.readdirSync(insideRoot(root,dir),{withFileTypes:true});}catch(e){if(e.code!=="ENOENT"||!virtual.has(dir))issues.push(issue("unreadable_directory",dir,"unverifiable",e.message));return;}
  for(const ent of entries){const rel=path.posix.join(dir,ent.name);if(ent.name==="_Index.md")continue;
   if(excluded(project,rel)){skipped.push({path:rel,status:"excluded"});continue;}
   if(ent.isSymbolicLink()){issues.push(issue("symlink",rel,"unverifiable","Symbolic links are not followed."));continue;}
   const role=roleFor(project,rel);
   if(!role){if(!["AGENTS.md","CLAUDE.md",".gitignore"].includes(rel))issues.push(issue("unregistered_location",rel,"needs_judgment","No workspace role is registered for this item."));continue;}
   addEntry(dir,{path:rel,name:ent.name,directory:ent.isDirectory()});
   if(ent.isDirectory())walk(rel);
  }
 }
 walk(".");
 for(const d of ["docs",...project.workspaces.map(w=>w.path),...extraDirectories]) {
  if(!isRelative(d))throw new Error(`Invalid index directory: ${d}`);insideRoot(root,d);
  if(excluded(project,d))continue;
  walk(d);
  let child=d;
  while(child!=="."){const parent=path.posix.dirname(child);addEntry(parent,{path:child,name:path.posix.basename(child),directory:true});child=parent;}
 }
 for(const entries of directories.values())entries.sort((a,b)=>a.path.localeCompare(b.path,"en"));
 return {project,directories,issues,excluded:skipped};
}
function escapeCell(text){return String(text).replace(/[\r\n]/g," ").replace(/\|/g,"&#124;").replace(/[<>]/g,c=>c==="<"?"&lt;":"&gt;");}
function blockFor(project,dir,entries,manual) {
 const rows=[START,"| Item | Path | Purpose | Scope |","|---|---|---|---|"];
 for(const entry of entries){
  const target=entry.directory?path.posix.join(entry.path,"_Index.md"):entry.path;
  if(manual.has(target)||manual.has(entry.path))continue;
  const d=(project.config.documents||[]).find(d=>d.path===entry.path);const role=roleFor(project,entry.path);
  const relative=path.posix.relative(dir,target);const url="./"+relative.split("/").map(encodeURIComponent).join("/");
  rows.push(`| ${escapeCell(entry.name)} | [open](${url}) | ${escapeCell(d?.purpose||role?.purpose||"Purpose not yet configured")} | ${escapeCell(d?.scope||role?.scope||"root")} |`);
 }
 rows.push(END);return rows.join("\n")+"\n";
}
function buildIndexPlan(root,options={}) {
 const inv=inventory(root,options),ops=[];
 if(inv.issues.some(i=>i.rule==="unreadable_directory"))throw new Error("Cannot update indexes while a directory is unreadable.");
 for(const [dir,entries] of inv.directories){
  if(options.paths?.length&&!options.paths.some(p=>isUnder(p,dir)||isUnder(dir,p)))continue;
  const file=path.posix.join(dir,"_Index.md");const before=readIndex(root,file);
  const text=before||`# ${dir==="."?"Workspace map":escapeCell(path.posix.basename(dir))}\n\n`;
  const manualText=unmanaged(text);const manual=new Set(links(manualText,dir).map(l=>resolveLink(root,l)).filter(Boolean));
  const block=blockFor(inv.project,dir,entries,manual);const s=text.indexOf(START),e=text.indexOf(END);
  const after=s<0?text+(text.endsWith("\n")?"":"\n")+block:text.slice(0,s)+block.trimEnd()+text.slice(e+END.length);
  if(after!==before)ops.push({type:before===null?"create":"update",path:file,before,after});
 }
 return ops;
}
function atomic(root,relative,content){const p=insideRoot(root,relative);fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+`.hames-${crypto.randomUUID()}.tmp`;try{fs.writeFileSync(tmp,content,{flag:"wx",mode:fs.existsSync(p)?fs.statSync(p).mode&0o777:0o644});fs.renameSync(tmp,p);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function planHash(ops) { return "sha256:"+crypto.createHash("sha256").update(JSON.stringify(ops)).digest("hex"); }
function syncIndexes(root,options={}) {
 const lockPath=insideRoot(root,".hames/state/index.lock");fs.mkdirSync(path.dirname(lockPath),{recursive:true});let lock;
 const queue=insideRoot(root,".hames/state/index-queue");fs.mkdirSync(queue,{recursive:true});
 atomic(root,`.hames/state/index-queue/${crypto.randomUUID()}.json`,JSON.stringify({paths:options.paths||[],queued_at:new Date().toISOString()}));
 let lockError;
 for(let attempt=0;attempt<20;attempt++) {
  try{lock=fs.openSync(lockPath,"wx",0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));break;}
  catch(e){lockError=e;if(e.code!=="EEXIST")break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}
 }
 if(lock===undefined)return {ok:false,reason:`Index update queued; writer is busy or unavailable: ${lockError.message}`,updated:[]};
 const updated=[];
 try{
  const pendingPath=insideRoot(root,".hames/state/index-pending.json");
  const queued=fs.readdirSync(queue).filter(n=>n.endsWith(".json"));
  const hadPending=fs.existsSync(pendingPath)||queued.length>1;
  const ops=buildIndexPlan(root,{...options,paths:hadPending?undefined:options.paths});
  if(options.expectedPlanHash && planHash(ops)!==options.expectedPlanHash)throw new Error("Index preview changed; review a new plan.");
  atomic(root,".hames/state/index-pending.json",JSON.stringify({paths:ops.map(o=>o.path),started_at:new Date().toISOString()})+"\n");
  for(const o of ops){
   if(options.failAfter!==undefined&&updated.length===options.failAfter)throw new Error("Simulated index write failure");
   options.beforeWrite?.(o);
   if(readIndex(root,o.path)!==o.before)throw new Error(`Index changed during update: ${o.path}`);
   atomic(root,o.path,o.after);updated.push(o.path);
  }
  fs.unlinkSync(pendingPath);for(const name of queued)fs.unlinkSync(path.join(queue,name));return {ok:true,updated};
 }catch(e){return {ok:false,reason:e.message,updated};}
 finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
}
function auditIndexes(root,options={}) {
 const inv=inventory(root,options);const issues=[...inv.issues];const checked=[];
 let target=options.target;
 if(target){target=inv.project.workspaces.find(w=>w.id===target)?.path||target;if(!isRelative(target))throw new Error("Invalid audit target");insideRoot(root,target);}
 for(const [dir,entries] of inv.directories){
  if(target&&!isUnder(dir,target))continue;
  const file=path.posix.join(dir,"_Index.md");checked.push(file);
  let text;try{text=readIndex(root,file);if(text!==null)unmanaged(text);}catch(e){issues.push(issue("unreadable_index",file,"unverifiable",e.message));continue;}
  if(text===null){issues.push(issue("missing_index",file,"violation","Managed folder has no index.","Request an index repair after reviewing its preview."));}
  const refs=text===null?[]:links(text,dir);const counts=new Map();
  for(const l of refs){const resolved=resolveLink(root,l);counts.set(resolved,(counts.get(resolved)||0)+1);let exists=false;try{exists=resolved&&fs.existsSync(insideRoot(root,resolved));}catch{}
   if(!exists)issues.push(issue("broken_link",file,"violation",`Missing or unsafe link: ${l.raw}`));
  }
  for(const [p,n] of counts)if(n>1)issues.push(issue("duplicate_link",file,"violation",`Repeated link: ${p}`));
  for(const e of entries){const expected=e.directory?path.posix.join(e.path,"_Index.md"):e.path;
   if(text!==null&&!counts.has(expected)&&!counts.has(e.path))issues.push(issue("unlisted_file",e.path,"violation",`Not listed in ${file}`));
   if(!e.directory){issues.push(...checkFile(inv.project,e.path));if(e.path.startsWith("docs/")&&!(inv.project.config.documents||[]).some(d=>d.path===e.path))issues.push(issue("document_scope",e.path,"needs_judgment","Shared document needs a purpose and scope in the document registry."));}
  }
 }
 const scoped=target?issues.filter(i=>isUnder(i.path,target)):issues;
 if(target&&!checked.length)scoped.push(issue("unknown_target",target,"unverifiable","No managed folder matched this target."));
 return {ok:scoped.length===0,checked,issues:scoped,excluded:inv.excluded,summary:{violations:scoped.filter(i=>i.status==="violation").length,needs_judgment:scoped.filter(i=>i.status==="needs_judgment").length,unverifiable:scoped.filter(i=>i.status==="unverifiable").length}};
}
if(require.main===module) {
 try {
  const args=process.argv.slice(2), get=(name)=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const root=get("--root")||process.cwd(),target=get("--target"),command=args[0]||"audit";
  let result;
  if(command==="plan") {const operations=buildIndexPlan(root);result={operations,plan_hash:planHash(operations)};}
  else if(command==="apply") {if(!args.includes("--approved")||!get("--plan-hash"))throw new Error("The approved index preview hash is required.");result=syncIndexes(root,{expectedPlanHash:get("--plan-hash")});}
  else if(command==="audit"||command.startsWith("--"))result=auditIndexes(root,{target});
  else throw new Error("Expected audit, plan, or apply");
  console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={planHash,START,END,inventory,buildIndexPlan,syncIndexes,auditIndexes,links,unmanaged,resolveLink};
