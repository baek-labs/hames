#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {loadProject,insideRoot,ownerFor}=require("./workspace");
function sessionPath(sessionId){return `.hames/state/context/${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`;}
function selectContext(root,{cwd=root,workspace,sessionId,maxBytes=32000,documentPaths=[]}={}){
 const project=loadProject(root),files=[],missing=[],parts=[];let bytes=0;
 let selected=workspace?project.workspaces.find(w=>w.id===workspace||w.path===workspace):null;
 if(workspace&&!selected)throw new Error("Unknown workspace selection");
 const local=path.relative(root,path.resolve(cwd)).split(path.sep).join("/")||".";
 if(!selected&&local!==".")selected=ownerFor(project.workspaces,local);
 if(!selected&&sessionId){const p=insideRoot(root,sessionPath(sessionId));if(fs.existsSync(p)){const saved=JSON.parse(fs.readFileSync(p,"utf8"));selected=project.workspaces.find(w=>w.id===saved.workspace);}}
 if(!selected&&project.workspaces.length===1)selected=project.workspaces[0];
 parts.push(`Hames workspace: ${selected?selected.id:"not yet selected; ask only if the task does not identify a workspace"}. Ordinary work needs no Git. Follow configured file rules and preserve user files. Use only documents relevant to the current scope.`);
 parts.push(`Workspace map: ${project.workspaces.map(w=>`${JSON.stringify(w.id)} at ${JSON.stringify(w.path)}: ${JSON.stringify(w.purpose)}`).join("; ")}`);
 if(sessionId)parts.push(`Session identifier for context selection: ${JSON.stringify(sessionId)}`);
 const seen=new Set();
 function read(relative,reason){
  if(seen.has(relative))return;seen.add(relative);
  try{const p=insideRoot(root,relative);const stat=fs.statSync(p);if(!stat.isFile())throw new Error("Not a regular file");if(bytes+stat.size>maxBytes){missing.push({path:relative,reason:"Context size limit; read this required document in a separate bounded step."});return;}const text=fs.readFileSync(p,"utf8");bytes+=Buffer.byteLength(text);files.push(relative);parts.push(`\n--- ${JSON.stringify(relative)} (${reason}) ---\n${text}`);}catch(e){missing.push({path:relative,reason:e.message});}
 }
 read("_Index.md","root navigation");read("docs/_Index.md","document navigation only");
 if(selected){read(`.hames/workspaces/${selected.id}.yaml`,"selected workspace rules");read(path.posix.join(selected.path,"_Index.md"),"selected workspace navigation");}
 const docs=new Map((project.config.documents||[]).map(d=>[d.path,d]));const visited=new Set();
 function document(p){if(visited.has(p))return;visited.add(p);const d=docs.get(p);if(!d){missing.push({path:p,reason:"Document is not registered; confirm its purpose and scope first."});return;}read(p,`${d.scope}: ${d.purpose}`);for(const dependency of d.depends||[])document(dependency);}
 for(const d of docs.values())if(d.scope==="common"||d.scope===selected?.id)document(d.path);
 for(const p of selected?.context||[])if(docs.has(p))document(p);else missing.push({path:p,reason:"Legacy context is not registered in shared docs; review it during setup migration."});
 for(const p of documentPaths)document(p);
 if(sessionId){const pointer=insideRoot(root,`.hames/state/sessions/${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);if(fs.existsSync(pointer)){const p=JSON.parse(fs.readFileSync(pointer,"utf8"));if(!/^[a-z0-9][a-z0-9._-]*$/.test(p.task_id)||p.contract_path!==`.hames/contracts/active/${p.task_id}`||path.resolve(p.project_root||"")!==path.resolve(root))throw new Error("Invalid active contract pointer");read(`${p.contract_path}/contract.md`,"active task contract");}}
 if(missing.length)parts.push("Context is incomplete: "+JSON.stringify(missing));
 return {loaded:true,workspace:selected?.id||null,files,missing,bytes,context:parts.join("\n")};
}
function selectWorkspace(root,workspace,sessionId){if(!sessionId)throw new Error("Session id is required");const project=loadProject(root);const w=project.workspaces.find(w=>w.id===workspace||w.path===workspace);if(!w)throw new Error("Unknown workspace selection");const file=insideRoot(root,sessionPath(sessionId));fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+`.hames-${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify({workspace:w.id})+"\n",{mode:0o600});fs.renameSync(tmp,file);return selectContext(root,{workspace:w.id,sessionId});}
if(require.main===module){try{const a=process.argv.slice(2),get=n=>a.includes(n)?a[a.indexOf(n)+1]:undefined;const root=get("--root")||process.cwd();const r=a[0]==="select"?selectWorkspace(root,get("--workspace"),get("--session")):selectContext(root,{cwd:get("--cwd")||root,workspace:get("--workspace"),sessionId:get("--session"),documentPaths:get("--document")?[get("--document")]:[]});console.log(JSON.stringify(r,null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={selectContext,selectWorkspace};
