"use strict";

const ALLOWED_TRACKING = new Set(["tracked", "untracked"]);
const workspace = require("./workspace.js");
const CORE_FEATURES = ["setup", "ready", "go", "index", "doctor"];
const DEFAULT_CRITICAL_ACTIONS = ["delete", "destructive_overwrite", "send", "publish", "deploy", "payment", "permission_change", "external_mutation"];

function scalar(value, lineNumber) {
  const trimmed = value.trim();
  if (trimmed === "") return {};
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[\[\{\"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid value on line ${lineNumber}: ${error.message}`);
    }
  }
  return trimmed;
}

function parseConfig(source) {
  if (typeof source !== "string") throw new TypeError("Config source must be text");
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    const indent = line.match(/^ */)[0].length;
    if (indent % 2 !== 0) throw new Error(`Invalid indentation on line ${index + 1}`);
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) throw new Error(`Invalid mapping on line ${index + 1}`);
    while (stack.at(-1).indent >= indent) stack.pop();
    if (indent > stack.at(-1).indent + 2) throw new Error(`Invalid indentation on line ${index + 1}`);
    const parent = stack.at(-1).value;
    if (Object.hasOwn(parent, match[1])) throw new Error(`Duplicate key on line ${index + 1}`);
    const value = scalar(match[2] || "", index + 1);
    parent[match[1]] = value;
    if (match[2] === undefined || match[2] === "") stack.push({ indent, value });
  });
  return root;
}

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: ["config must be a mapping"] };
  }
  if (![1, 2].includes(config.version)) errors.push("version must be 1 or 2");
  const allowedTop = new Set(["version", "project", "workspaces", "tracking", "guards", "features", "extensions", "documents", "exclude"]);
  for (const key of Object.keys(config)) if (!allowedTop.has(key)) errors.push(`unknown config key: ${key}`);
  if (!config.project || typeof config.project.name !== "string" || !config.project.name.trim()) {
    errors.push("project.name must be a non-empty string");
  }
  if (config.project && Object.keys(config.project).some((key) => !new Set(["name", "root"]).has(key))) errors.push("project contains an unknown key");
  if (config.project?.root !== ".") errors.push("project.root must be '.'");
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0) {
    errors.push("workspaces must contain at least one workspace id");
  }
  if (Array.isArray(config.workspaces) && new Set(config.workspaces).size !== config.workspaces.length) errors.push("workspaces must not contain duplicates");
  if (!ALLOWED_TRACKING.has(config.tracking?.contracts)) {
    errors.push("tracking.contracts must be 'tracked' or 'untracked'");
  }
  if (config.tracking && Object.keys(config.tracking).some((key) => key !== "contracts")) errors.push("tracking contains an unknown key");
  if (config.guards?.enabled !== true) errors.push("guards.enabled must remain true for Hames Core");
  if (!Array.isArray(config.guards?.critical_actions) || DEFAULT_CRITICAL_ACTIONS.some((name) => !config.guards.critical_actions.includes(name))) {
    errors.push("guards.critical_actions cannot remove Hames critical-action defaults");
  }
  if (config.guards && Object.keys(config.guards).some((key) => !new Set(["enabled", "critical_actions"]).has(key))) errors.push("guards contains an unknown key");
  const requiredFeatures = config.version === 1 ? CORE_FEATURES.filter((n) => n !== "index") : CORE_FEATURES;
  if (!Array.isArray(config.features) || requiredFeatures.some((name) => !config.features.includes(name))) {
    errors.push("features must include the required Core skills");
  }
  if (Array.isArray(config.features) && (new Set(config.features).size !== config.features.length || config.features.some((name) => !CORE_FEATURES.includes(name)))) errors.push("features must contain only unique Core features");
  if (!config.extensions || typeof config.extensions !== "object" || Array.isArray(config.extensions)) {
    errors.push("extensions must be a mapping");
  } else if (Object.values(config.extensions).some((value) => !value || typeof value !== "object" || Array.isArray(value))) {
    errors.push("each extension setting must be a mapping");
  }
  if (Array.isArray(config.workspaces) && config.workspaces.some((id) => !workspace.validId(id))) errors.push("invalid workspace id");
  if (config.exclude !== undefined && (!Array.isArray(config.exclude) || config.exclude.some((p) => !workspace.isRelative(p) || p === "."))) errors.push("exclude must contain relative paths");
  if (config.documents !== undefined) {
    if (!Array.isArray(config.documents)) errors.push("documents must be an array");
    else {
      const seen = new Set();
      for (const d of config.documents) {
        if (!d || !workspace.isRelative(d.path) || !d.path.startsWith("docs/") || seen.has(d.path) || typeof d.purpose !== "string" || !d.purpose.trim() || !["common", ...(Array.isArray(config.workspaces) ? config.workspaces : [])].includes(d.scope) || (d.depends !== undefined && (!Array.isArray(d.depends) || d.depends.some((p) => !workspace.isRelative(p) || !p.startsWith("docs/"))))) errors.push("invalid scoped document");
        if (d) seen.add(d.path);
      }
      for (const d of config.documents) if (Array.isArray(d?.depends) && d.depends.some((p) => !seen.has(p))) errors.push("unknown document dependency");
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { ...workspace, CORE_FEATURES, DEFAULT_CRITICAL_ACTIONS, parseConfig, validateConfig };
