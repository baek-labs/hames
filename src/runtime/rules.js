"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {ownerFor,insideRoot,isRelative,DEFAULT_EXCLUDES}=require("./workspace.js");
function issue(rule,file,status,reason,action="Review this item before continuing.") { return {rule,path:file,status,reason,action}; }
function isUnder(file,dir) { return dir === "." || file===dir || file.startsWith(dir+"/"); }
function excluded(project,relative) {
 const parts=relative.split("/");
 if(parts.some(p=>DEFAULT_EXCLUDES.includes(p) || /^\.env(?:\.|$)/.test(p) || /\.(?:pem|key|p12|pfx)$/i.test(p) || /\.hames-.*\.tmp$/.test(p)))return true;
 if((project.config.exclude||[]).some(p=>isUnder(relative,p)))return true;
 const w=ownerFor(project.workspaces,relative);
 const local=w ? (w.path==="."?relative:relative.slice(w.path.length+1)) : relative;
 return Boolean(w && (w.exclude||[]).some(p=>isUnder(local,p)));
}
function roleFor(project,relative) {
 if(relative === "docs" || relative.startsWith("docs/"))return {scope:"system",purpose:"Shared operating documents"};
 const w=ownerFor(project.workspaces,relative);if(!w)return null;
 const local=w.path==="."?relative:relative===w.path?".":relative.slice(w.path.length+1);
 const f=(w.folders||[]).filter(f=>isUnder(local,f.path)).sort((a,b)=>b.path.length-a.path.length)[0];
 return {scope:w.id,purpose:f?.purpose||w.purpose||"Purpose not yet configured",workspace:w};
}
function checkFile(project,relative,{content,prewrite=false}={}) {
 if(!isRelative(relative))return [issue("path_escape",relative,"violation","Path must remain within the selected root.")];
 try{insideRoot(project.root,relative);}catch(e){return [issue("path_escape",relative,"violation",e.message)];}
 if(excluded(project,relative))return [];
 if(relative==="docs"||relative.startsWith("docs/")||["_Index.md","AGENTS.md","CLAUDE.md"].includes(path.posix.basename(relative)))return [];
 const w=ownerFor(project.workspaces,relative);if(!w)return [issue("unregistered_location",relative,"violation","No workspace owns this location.","Choose a registered workspace or configure this folder.")];
 const local=w.path==="."?relative:relative.slice(w.path.length+1);const out=[];
 for(const r of w.rules||[]) {
  if(!isUnder(local,r.path||"."))continue;
  if(r.kind==="extension"&&!r.value.includes(path.posix.extname(relative).toLowerCase()))out.push(issue(r.id,relative,"violation",`Allowed extensions: ${r.value.join(", ")}`));
  if(r.kind==="name"&&!new RegExp(r.value,"u").test(path.posix.basename(relative)))out.push(issue(r.id,relative,"violation",`File name must match ${r.value}`));
  if(r.kind==="semantic")out.push(issue(r.id,relative,"needs_judgment",r.value,"Check the content against the folder purpose; ask if uncertain."));
  if(r.kind==="required") {
   let text=content;
   if(text===undefined&&!prewrite) {
    try{const p=insideRoot(project.root,relative);if(fs.statSync(p).size>1024*1024||!/[.](md|txt|csv|json|ya?ml|html)$/i.test(relative)){out.push(issue(r.id,relative,"unverifiable","Content format or size is not supported for required-text inspection."));continue;}text=fs.readFileSync(p,"utf8");}
    catch(e){out.push(issue(r.id,relative,"unverifiable",e.message));continue;}
   }
   if(typeof text==="string"&&!text.includes(r.value))out.push(issue(r.id,relative,"violation",`Required text is missing: ${r.value}`));
  }
 }
 return out;
}
module.exports={issue,isUnder,excluded,roleFor,checkFile};
