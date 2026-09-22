"use strict";
const fs = require("node:fs");
const path = require("node:path");
const DEFAULT_EXCLUDES = [".git", ".hames", "node_modules", ".cache", ".next", "dist", "build", "coverage", ".DS_Store"];
function validId(id) { return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id); }
function isRelative(value) {
  return typeof value === "string" && value.length > 0 && !/[\\\x00-\x1f]/.test(value) && !/^[A-Za-z]:/.test(value) && !path.posix.isAbsolute(value) && path.posix.normalize(value) === value && value !== ".." && !value.startsWith("../");
}
function insideRoot(root, relative) {
  if (!isRelative(relative)) throw new Error(`Invalid relative path: ${relative}`);
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink path is not managed: ${relative}`); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return path.resolve(base, relative);
}
function validateWorkspace(w) {
  const errors = [];
  if (!w || typeof w !== "object" || Array.isArray(w)) return { valid:false, errors:["workspace must be a mapping"] };
  if (![1,2].includes(w.version)) errors.push("invalid workspace version");
  if (!validId(w.id) || w.id === "common") errors.push("invalid workspace id");
  if (!isRelative(w.path) || ["docs", ".hames", ".git"].some((p) => w.path === p || (typeof w.path === "string" && w.path.startsWith(p + "/")))) errors.push("invalid workspace path");
  if (w.version === 2 && (typeof w.purpose !== "string" || !w.purpose.trim())) errors.push("workspace purpose is required");
  for (const key of ["context","protect","exclude"]) if (w[key] !== undefined && (!Array.isArray(w[key]) || w[key].some((p) => !isRelative(p)))) errors.push(`invalid ${key}`);
  if (w.exclude?.includes(".")) errors.push("cannot exclude entire workspace");
  const folders = w.folders || [];
  if (!Array.isArray(folders)) errors.push("folders must be an array");
  else {
    const seen = new Set();
    for (const f of folders) {
      const canonical = typeof f?.path === "string" ? f.path.normalize("NFC").toLowerCase() : null;
      if (!f || !isRelative(f.path) || seen.has(canonical) || typeof f.purpose !== "string" || !f.purpose.trim()) errors.push("invalid or conflicting folder role");
      seen.add(canonical);
    }
  }
  const rules = w.rules || [];
  if (!Array.isArray(rules)) errors.push("rules must be an array");
  else {
    const ids = new Set();
    for (const r of rules) {
      if (!r || !validId(r.id) || ids.has(r.id) || !isRelative(r.path || ".") || !["extension","name","required","semantic"].includes(r.kind)) { errors.push("invalid rule"); continue; }
      ids.add(r.id);
      if (r.kind === "extension" && (!Array.isArray(r.value) || !r.value.length || r.value.some((v) => typeof v !== "string" || !/^\.[A-Za-z0-9]+$/.test(v)))) errors.push("invalid extension rule");
      if (r.kind !== "extension" && (typeof r.value !== "string" || !r.value.trim())) errors.push("rule text is required");
      if (r.kind === "name") { try { new RegExp(r.value, "u"); } catch { errors.push("invalid name regular expression"); } }
    }
  }
  return { valid:errors.length === 0, errors };
}
function loadProject(root) {
  const {parseConfig,validateConfig}=require("./config.js");
  const config = parseConfig(fs.readFileSync(insideRoot(root,".hames/config.yaml"),"utf8"));
  const checked=validateConfig(config); if (!checked.valid) throw new Error(checked.errors.join("; "));
  const workspaces=config.workspaces.map((id) => {
    const w=parseConfig(fs.readFileSync(insideRoot(root,`.hames/workspaces/${id}.yaml`),"utf8"));
    const v=validateWorkspace(w); if (!v.valid || w.id !== id) throw new Error(`Workspace ${id}: ${v.errors.join("; ") || "identifier mismatch"}`);
    insideRoot(root,w.path); return w;
  });
  const paths=new Set();
  for (const w of workspaces) { const key=w.path.normalize("NFC").toLowerCase(); if (paths.has(key)) throw new Error("Conflicting workspace paths"); paths.add(key); }
  return {root:path.resolve(root),config,workspaces};
}
function ownerFor(workspaces, relative) {
  return workspaces.filter((w) => w.path === "." || relative === w.path || relative.startsWith(w.path+"/")).sort((a,b) => b.path.length-a.path.length)[0] || null;
}
module.exports = { DEFAULT_EXCLUDES, validateWorkspace, validId, isRelative, insideRoot, loadProject, ownerFor };
