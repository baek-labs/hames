"use strict";
// Explicit manual host smoke: node tests/host/claude-smoke.js (not an automatic test).
if (!process.env.NODE_TEST_CONTEXT) {
const fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process");
const {planSetup,applySetup}=require("../../src/runtime/setup");
const repo=path.resolve(__dirname,"../.."),root=path.join(repo,"tests/.tmp/claude-configured");
fs.mkdirSync(root,{recursive:true});
const plan=planSetup({root,skipLegacy:true,contractTracking:"untracked",workspaces:[{id:"work",path:"work",purpose:"Test documents",rules:[{id:"markdown",kind:"extension",path:".",value:[".md"]}]},{id:"study",path:"study",purpose:"Unrelated test documents"}],documents:[{path:"docs/common.md",purpose:"Common rules",scope:"common"},{path:"docs/work.md",purpose:"Work rules",scope:"work"},{path:"docs/study.md",purpose:"Unrelated rules",scope:"study"}]});
applySetup(plan,{approved:true});
for(const name of ["common","work","study"])fs.writeFileSync(path.join(root,`docs/${name}.md`),`${name.toUpperCase()}_HOST_CONTEXT_SENTINEL\n`);
require("../../src/runtime/index").syncIndexes(root);
const output=path.join(repo,"tests/.tmp/claude-smoke");fs.mkdirSync(output,{recursive:true});
const args=["-p","In this preconfigured test workspace, use Write to create probe.md with the exact text '# Probe\\nHost file-hook verification.\\n'. Then read _Index.md and report whether probe.md was automatically indexed. Do not edit the index yourself. Also report which HOST_CONTEXT_SENTINEL values were supplied by startup context; do not read the unrelated study document. Use only Read and Write tools. This is a local test; do not send or publish anything.","--model","sonnet","--plugin-dir",path.join(repo,"packages/claude"),"--setting-sources","","--strict-mcp-config","--mcp-config",'{"mcpServers":{}}',"--no-session-persistence","--verbose","--output-format","stream-json","--tools","Read,Write","--allowedTools","Read,Write","--permission-mode","acceptEdits"];
const out=fs.openSync(path.join(output,"configured.jsonl"),"w"),err=fs.openSync(path.join(output,"configured.stderr"),"w");
const child=spawn("claude",args,{cwd:path.join(root,"work"),stdio:["ignore",out,err]});
child.on("error",e=>{fs.writeFileSync(path.join(output,"configured.exit"),"error: "+e.message);process.exitCode=1;});
child.on("exit",code=>{fs.writeFileSync(path.join(output,"configured.exit"),String(code));console.log(`Claude configured smoke exit ${code}`);process.exitCode=code||0;});

}
