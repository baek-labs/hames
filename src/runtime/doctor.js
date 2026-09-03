#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseConfig, validateConfig } = require("./config.js");
const { computeSpecHash, normalizeRelative, validateSpec } = require("./contract.js");

function check(id, status, detail) {
  return { id, status, detail };
}

function schemaErrors(value, schema, location = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  const allowedTypes = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (allowedTypes && !allowedTypes.includes(actualType) && !(actualType === "integer" && allowedTypes.includes("number"))) {
    errors.push(`${location} must be ${allowedTypes.join(" or ")}`);
    return errors;
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${location} is not in enum`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location} is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match pattern`);
    if (schema.format === "uri") { try { new URL(value); } catch { errors.push(`${location} must be a URI`); } }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${location} is below minimum`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location} has too few items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${location} has duplicate items`);
    if (schema.items) value.forEach((item, index) => schemaErrors(item, schema.items, `${location}[${index}]`, errors));
    for (const clause of schema.allOf || []) {
      if (clause.contains && !value.some((item) => schemaErrors(item, clause.contains, location, []).length === 0)) errors.push(`${location} is missing a required item`);
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${location}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) schemaErrors(item, schema.properties[key], `${location}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${location}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") schemaErrors(item, schema.additionalProperties, `${location}.${key}`, errors);
    }
  }
  return errors;
}

function safeProjectPath(root, relative) {
  const normalized = normalizeRelative(relative);
  const rootReal = fs.realpathSync(root);
  const absolute = path.resolve(root, normalized);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor);
  const escaped = path.relative(rootReal, real);
  if (escaped === ".." || escaped.startsWith(`..${path.sep}`) || path.isAbsolute(escaped)) throw new Error(`Workspace path escapes project: ${relative}`);
  return normalized;
}

function diagnose(root = process.cwd(), { pluginRoot = path.resolve(__dirname, "..") } = {}) {
  const projectRoot = path.resolve(root);
  const checks = [];
  const recovery = [];
  const sourceLayout = fs.existsSync(path.join(pluginRoot, "src/skills"));
  const skillsRoot = path.join(pluginRoot, sourceLayout ? "src/skills" : "skills");
  const hooksRoot = path.join(pluginRoot, sourceLayout ? "src/hooks" : "hooks");
  const schemasRoot = path.join(pluginRoot, sourceLayout ? "src/schemas" : "schemas");
  const loadedSchemas = {};
  for (const name of ["config.schema.json", "contract.schema.json"]) {
    try { loadedSchemas[name] = JSON.parse(fs.readFileSync(path.join(schemasRoot, name), "utf8")); } catch {}
  }
  const configFile = path.join(projectRoot, ".hames/config.yaml");
  let config = null;
  try {
    safeProjectPath(projectRoot, ".hames/config.yaml");
    const parsed = parseConfig(fs.readFileSync(configFile, "utf8"));
    const validation = validateConfig(parsed);
    const structural = schemaErrors(parsed, loadedSchemas["config.schema.json"] || {});
    const valid = validation.valid && structural.length === 0;
    if (valid) config = parsed;
    checks.push(check("config", valid ? "pass" : "fail", valid ? "Configuration is valid." : [...validation.errors, ...structural].join("; ")));
    if (!valid) recovery.push("Repair config.yaml from an approved /setup preview; do not infer missing values.");
  } catch (error) {
    checks.push(check("config", "fail", error.message));
    recovery.push("Repair config.yaml from an approved /setup preview; do not infer missing values.");
  }

  for (const relative of [".hames/workspaces", ".hames/context", ".hames/contracts/active", ".hames/contracts/archive", ".hames/state"]) {
    try {
      safeProjectPath(projectRoot, relative);
      checks.push(check(`path:${relative}`, fs.existsSync(path.join(projectRoot, relative)) ? "pass" : "fail", relative));
    } catch (error) {
      checks.push(check(`path:${relative}`, "fail", error.message));
    }
  }
  if (config) {
    for (const workspaceId of config.workspaces) {
      const workspaceFile = path.join(projectRoot, ".hames/workspaces", `${workspaceId}.yaml`);
      try {
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(workspaceId)) throw new Error("Workspace id is invalid");
        const workspace = parseConfig(fs.readFileSync(workspaceFile, "utf8"));
        if (workspace.version !== 1 || workspace.id !== workspaceId || typeof workspace.path !== "string") throw new Error("Workspace identity or version is invalid");
        safeProjectPath(projectRoot, workspace.path);
        if (!Array.isArray(workspace.context) || !Array.isArray(workspace.protect)) throw new Error("Workspace context and protect must be arrays");
        for (const item of [...workspace.context, ...workspace.protect]) safeProjectPath(projectRoot, item);
        checks.push(check(`workspace:${workspaceId}`, "pass", workspace.path));
      } catch (error) {
        checks.push(check(`workspace:${workspaceId}`, "fail", error.message));
        recovery.push(`Repair workspace ${workspaceId} from an approved /setup preview.`);
      }
    }
  }
  for (const relative of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(projectRoot, relative);
    const present = fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("<!-- HAMES:START -->");
    checks.push(check(`entry:${relative}`, present ? "pass" : "warn", present ? "Hames boundary block is present." : "Hames boundary block is missing."));
  }

  const recoveryFile = path.join(projectRoot, ".hames/state/setup-recovery.json");
  if (fs.existsSync(recoveryFile)) {
    checks.push(check("setup-recovery", "fail", "Interrupted setup recovery record exists."));
    recovery.push("Review the setup recovery record and run the setup runtime recovery command before retrying /setup.");
  } else checks.push(check("setup-recovery", "pass", "No interrupted setup record."));
  const legacyRecovery = path.join(projectRoot, ".hames/state/legacy-recovery.json");
  if (fs.existsSync(legacyRecovery)) {
    checks.push(check("legacy-recovery", "fail", "Interrupted legacy transition recovery record exists."));
    recovery.push("Review the legacy recovery record and restore only this transition before retrying /setup.");
  } else checks.push(check("legacy-recovery", "pass", "No interrupted legacy transition record."));
  const contractStaging = path.join(projectRoot, ".hames/state/contract-staging");
  const stagedContracts = fs.existsSync(contractStaging) ? fs.readdirSync(contractStaging) : [];
  checks.push(check("contract-staging", stagedContracts.length ? "fail" : "pass", stagedContracts.length ? `Interrupted contract staging entries: ${stagedContracts.join(", ")}` : "No interrupted contract staging."));
  if (stagedContracts.length) recovery.push("Review and remove only the identified interrupted contract staging entries before retrying /ready.");
  const lockRoot = path.join(projectRoot, ".hames/state/locks");
  const taskLocks = fs.existsSync(lockRoot) ? fs.readdirSync(lockRoot).filter((name) => name.endsWith(".lock")) : [];
  checks.push(check("contract-locks", taskLocks.length ? "fail" : "pass", taskLocks.length ? `Contract locks require review: ${taskLocks.join(", ")}` : "No contract locks remain."));
  if (taskLocks.length) recovery.push("Inspect lock owner and age before choosing whether to retry or clear a stale contract lock.");

  for (const area of ["active", "archive"]) {
    const areaRoot = path.join(projectRoot, ".hames/contracts", area);
    if (!fs.existsSync(areaRoot)) continue;
    try { safeProjectPath(projectRoot, `.hames/contracts/${area}`); }
    catch (error) { checks.push(check(`contracts:${area}`, "fail", error.message)); continue; }
    for (const taskId of fs.readdirSync(areaRoot)) {
      const directory = path.join(areaRoot, taskId);
      if (!fs.statSync(directory).isDirectory()) continue;
      try {
        const contract = JSON.parse(fs.readFileSync(path.join(directory, "contract.json"), "utf8"));
        const specification = validateSpec(contract);
        const structural = schemaErrors(contract, loadedSchemas["contract.schema.json"] || {});
        const valid = specification.valid && structural.length === 0 && contract.task_id === taskId && contract.spec_hash === computeSpecHash(contract);
        checks.push(check(`contract:${area}:${taskId}`, valid ? "pass" : "fail", valid ? contract.status : `Contract schema, identifier, or hash mismatch: ${[...specification.errors, ...specification.questions.map((item) => item.field), ...structural].join("; ")}`));
        if (!valid) recovery.push(`Restore or amend contract ${taskId}, then obtain approval again.`);
        try {
          const evidence = JSON.parse(fs.readFileSync(path.join(directory, "evidence.json"), "utf8"));
          const linked = evidence.task_id === contract.task_id && evidence.revision === contract.revision && evidence.spec_hash === contract.spec_hash;
          checks.push(check(`evidence:${area}:${taskId}`, linked ? "pass" : "fail", linked ? "Evidence store matches the contract." : "Evidence store linkage mismatch."));
          if (!linked) recovery.push(`Discard or recollect evidence for ${taskId} after re-approval.`);
        } catch (error) {
          checks.push(check(`evidence:${area}:${taskId}`, "fail", error.message));
          recovery.push(`Recreate evidence metadata for ${taskId} through an approved execution.`);
        }
        try {
          const events = fs.readFileSync(path.join(directory, "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
          const lifecycle = events.filter((item) => ["created", "approved", "activated", "review_ready", "accepted", "archived", "amended"].includes(item.type));
          const aligned = lifecycle.length > 0 && lifecycle.at(-1).status === contract.status;
          checks.push(check(`events:${area}:${taskId}`, aligned ? "pass" : "fail", aligned ? "Latest lifecycle event matches contract status." : "Lifecycle event and contract status mismatch."));
          if (!aligned) recovery.push(`Review the interrupted state transition for ${taskId}.`);
        } catch (error) {
          checks.push(check(`events:${area}:${taskId}`, "fail", error.message));
          recovery.push(`Review unreadable lifecycle events for ${taskId}.`);
        }
      } catch (error) {
        checks.push(check(`contract:${area}:${taskId}`, "fail", error.message));
        recovery.push(`Inspect unreadable contract ${taskId}; do not select a different contract automatically.`);
      }
    }
  }

  const sessions = path.join(projectRoot, ".hames/state/sessions");
  if (fs.existsSync(sessions)) {
    for (const name of fs.readdirSync(sessions).filter((item) => item.endsWith(".json"))) {
      try {
        const pointer = JSON.parse(fs.readFileSync(path.join(sessions, name), "utf8"));
        const safeId = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(pointer.task_id || "");
        const expectedPath = safeId ? `.hames/contracts/active/${pointer.task_id}` : null;
        if (!safeId || pointer.contract_path !== expectedPath || path.resolve(pointer.project_root || "") !== projectRoot) throw new Error("Session pointer project or contract path is invalid");
        const contract = JSON.parse(fs.readFileSync(path.join(projectRoot, expectedPath, "contract.json"), "utf8"));
        const valid = new Set(["ACTIVE", "REVIEW"]).has(contract.status) && pointer.task_id === contract.task_id && pointer.revision === contract.revision && pointer.spec_hash === contract.spec_hash;
        checks.push(check(`session:${name}`, valid ? "pass" : "fail", valid ? pointer.task_id : "Session pointer mismatch."));
        if (!valid) recovery.push(`Choose whether to resume, amend, or clear the mismatched session for ${pointer.task_id}.`);
      } catch (error) {
        checks.push(check(`session:${name}`, "fail", error.message));
        recovery.push(`Review unreadable session pointer ${name}; do not clear it automatically.`);
      }
    }
  }

  for (const name of ["setup", "ready", "go", "doctor"]) {
    checks.push(check(`skill:${name}`, fs.existsSync(path.join(skillsRoot, name, "SKILL.md")) ? "pass" : "fail", name));
  }
  for (const name of ["scope-guard.js", "evidence-guard.js", "context-loader.js"]) {
    checks.push(check(`hook:${name}`, fs.existsSync(path.join(hooksRoot, name)) ? "pass" : "fail", name));
  }
  for (const name of ["config.schema.json", "contract.schema.json"]) {
    try {
      const schema = JSON.parse(fs.readFileSync(path.join(schemasRoot, name), "utf8"));
      if (schema.type !== "object" || !Array.isArray(schema.required)) throw new Error("Schema root must be an object with required fields");
      checks.push(check(`schema:${name}`, "pass", schema.$id || name));
    } catch (error) {
      checks.push(check(`schema:${name}`, "fail", error.message));
    }
  }
  try {
    const hooks = JSON.parse(fs.readFileSync(path.join(hooksRoot, "hooks.json"), "utf8"));
    const expected = { SessionStart: "context-loader.js", PreToolUse: "scope-guard.js", PostToolUse: "evidence-guard.js" };
    for (const [event, script] of Object.entries(expected)) {
      const handlers = hooks.hooks?.[event]?.flatMap((group) => group.hooks || []) || [];
      const expectedCommand = `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"`;
      if (!handlers.some((handler) => handler.type === "command" && handler.command === expectedCommand && Number.isFinite(handler.timeout) && handler.timeout > 0)) throw new Error(`${event} does not safely invoke ${script}`);
    }
    checks.push(check("hook:hooks.json", "pass", "Required lifecycle handlers are connected."));
  } catch (error) {
    checks.push(check("hook:hooks.json", "fail", error.message));
  }
  const manifestCandidates = sourceLayout
    ? [path.join(pluginRoot, "platform/codex/plugin.json"), path.join(pluginRoot, "platform/claude/plugin.json")]
    : [path.join(pluginRoot, ".codex-plugin/plugin.json"), path.join(pluginRoot, ".claude-plugin/plugin.json")];
  const manifests = manifestCandidates.filter((file) => fs.existsSync(file));
  try {
    if (!manifests.length) throw new Error("No supported plugin manifest found");
    for (const file of manifests) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.name !== "hames" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || "") || typeof manifest.description !== "string") throw new Error(`Invalid plugin manifest: ${file}`);
    }
    checks.push(check("plugin-manifest", "pass", manifests.map((file) => path.basename(path.dirname(file))).join(", ")));
  } catch (error) {
    checks.push(check("plugin-manifest", "fail", error.message));
  }
  checks.push(check("contract-tracking", config ? "pass" : "warn", config?.tracking?.contracts || "Unknown while config is invalid."));
  return { ok: checks.every((item) => item.status !== "fail"), project_root: projectRoot, checks, recovery };
}

if (require.main === module) {
  const rootIndex = process.argv.indexOf("--root");
  const pluginIndex = process.argv.indexOf("--plugin-root");
  const result = diagnose(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd(), {
    pluginRoot: pluginIndex >= 0 ? process.argv[pluginIndex + 1] : path.resolve(__dirname, ".."),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { diagnose };
