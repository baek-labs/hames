#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {findProjectRoot,toolPaths,inferredKind}=require("./scope-guard");
const {loadProject,insideRoot}=require("../runtime/workspace");
const {excluded}=require("../runtime/rules");
const {syncIndexes}=require("../runtime/index");
function observe(root,event,result){const file=insideRoot(root,".hames/state/hook-observations.json");fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+`.hames-${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify({event:"PostToolUse",tool:event.tool_name,observed_at:new Date().toISOString(),index_ok:result.ok})+"\n",{mode:0o600});fs.renameSync(tmp,file);}
function syncAfterTool(event){
 const root=findProjectRoot(event.cwd);if(!root)return {skipped:true,reason:"unconfigured"};
 const name=String(event.tool_name||"");
 if(!["Write","Edit","MultiEdit","NotebookEdit","apply_patch"].includes(name))return {skipped:true,reason:"unobserved_tool; use /index for shell or external changes"};
 const response=event.tool_response;
 if(response===undefined||response===null||response?.isError||response?.error||response?.success===false||Number.isInteger(response?.exit_code)&&response.exit_code!==0||typeof response==="string"&&/^(?:error|failed)\b/i.test(response))return {skipped:true,reason:"tool_did_not_report_success"};
 try{
  const project=loadProject(root);const paths=[];
  for(const candidate of toolPaths(event)){
   const absolute=path.resolve(event.tool_input?.cwd||event.cwd||root,candidate),relative=path.relative(root,absolute).split(path.sep).join("/");insideRoot(root,relative);
   if(path.posix.basename(relative)==="_Index.md"||excluded(project,relative))continue;
   const kind=inferredKind(event,absolute);
   if(kind!=="delete"&&!fs.existsSync(absolute))return {ok:false,reason:"Expected written file is not observable; run /index."};
   paths.push(relative);
  }
  if(!paths.length)return {skipped:true,reason:"no_managed_change"};
  const result=syncIndexes(root,{project,paths});observe(root,event,result);return result;
 }catch(e){return {ok:false,reason:e.message};}
}
if(require.main===module){let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",s=>input+=s);process.stdin.on("end",()=>{try{const result=syncAfterTool(JSON.parse(input||"{}"));if(result.ok===false)console.log(JSON.stringify({systemMessage:`Hames index update is incomplete: ${result.reason}. The source file was preserved. Use /doctor and /index.`}));}catch(e){console.log(JSON.stringify({systemMessage:`Hames index hook failed: ${e.message}`}));}});}
module.exports={syncAfterTool};
