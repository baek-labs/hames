#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseConfig, validateConfig } = require("./config.js");

const TEMPLATE_ROOT = path.resolve(__dirname, "../templates");
const HAMES_START = "<!-- HAMES:START -->";
const SETUP_MANAGED_PATHS = [
  ".hames", ".hames/workspaces", ".hames/context", ".hames/contracts",
  ".hames/contracts/active", ".hames/contracts/archive", ".hames/state",
  ".hames/config.yaml", ".hames/workspaces/default.yaml", ".hames/context/project.md",
  ".hames/state/setup-recovery.json", "AGENTS.md", "CLAUDE.md", ".gitignore",
];

function readTemplate(name, replacements = {}) {
  let content = fs.readFileSync(path.join(TEMPLATE_ROOT, name), "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${token}}}`, value);
  }
  return content;
}

function mergeBlock(existing, block) {
  const start = block.startsWith(HAMES_START) ? HAMES_START : "# HAMES:START";
  const end = start === HAMES_START ? "<!-- HAMES:END -->" : "# HAMES:END";
  const startIndex = existing.indexOf(start);
  if (startIndex >= 0) {
    const endIndex = existing.indexOf(end, startIndex);
    if (endIndex < 0) throw new Error(`Existing ${start} block has no closing marker`);
    const afterIndex = endIndex + end.length;
    return `${existing.slice(0, startIndex)}${block.trimEnd()}${existing.slice(afterIndex)}`;
  }
  const separator = existing.length === 0 || existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block.trimEnd()}\n`;
}

function addFileOperation(operations, root, relative, content, { update = false } = {}) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    operations.push({ type: "create", path: relative, before: null, after: content });
    return;
  }
  if (update) {
    const before = fs.readFileSync(absolute, "utf8");
    if (before !== content) operations.push({ type: "update", path: relative, before, after: content });
  }
}

function addEntryOperation(operations, root, relative, block) {
  const absolute = path.join(root, relative);
  const before = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
  const after = mergeBlock(before, block);
  if (after !== before) operations.push({ type: before ? "update" : "create", path: relative, before: before || null, after });
}

function isGitWorkingTree(root) {
  let current = path.resolve(root);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function assertManagedPath(root, relative) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const absolute = path.resolve(root, relative);
  const lexical = path.relative(path.resolve(root), absolute);
  if (lexical === ".." || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) throw new Error(`Managed path is outside the project: ${relative}`);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = fs.realpathSync(ancestor);
  const realRelative = path.relative(rootReal, resolved);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Managed path escapes the project through a symlink: ${relative}`);
  }
}

function assertPlanIsCurrent(plan) {
  for (const operation of plan.operations) {
    assertManagedPath(plan.root, operation.path);
    const target = path.join(plan.root, operation.path);
    if (operation.type === "mkdir" && fs.existsSync(target)) throw new Error(`Project changed after preview: ${operation.path} now exists`);
    if (operation.type === "create" && fs.existsSync(target)) throw new Error(`Project changed after preview: ${operation.path} now exists`);
    if (operation.type === "update" && (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== operation.before)) {
      throw new Error(`Project changed after preview: ${operation.path} is stale`);
    }
  }
}

function validSetupOperation(root, operation) {
  if (!operation || !new Set(["mkdir", "create", "update"]).has(operation.type)) throw new Error("Recovery journal contains an invalid operation type");
  const canonical = typeof operation.path === "string" && !operation.path.includes("\\") ? path.posix.normalize(operation.path) : null;
  const workspaceConfig = /^\.hames\/workspaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.yaml$/.test(canonical || "");
  if (!canonical || canonical !== operation.path || (!SETUP_MANAGED_PATHS.includes(canonical) && !workspaceConfig)) {
    throw new Error("Recovery journal contains an unapproved managed path");
  }
  assertManagedPath(root, operation.path);
  if (operation.type === "create" && (operation.before !== null || typeof operation.after !== "string")) throw new Error("Recovery create operation is invalid");
  if (operation.type === "update" && (typeof operation.before !== "string" || typeof operation.after !== "string")) throw new Error("Recovery update operation is invalid");
}

function previewSetupRecovery(root) {
  const projectRoot = path.resolve(root || process.cwd());
  const journal = path.join(projectRoot, ".hames/state/setup-recovery.json");
  let raw;
  try {
    assertManagedPath(projectRoot, ".hames/state/setup-recovery.json");
    if (!fs.existsSync(journal)) return { valid: false, recovery_hash: null, errors: ["No setup recovery record exists."], operations: [] };
    raw = fs.readFileSync(journal, "utf8");
  } catch (error) {
    return { valid: false, recovery_hash: null, errors: [error.message], operations: [] };
  }
  const recoveryHash = `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  const errors = [];
  let record;
  let operations = [];
  try {
    record = JSON.parse(raw);
    if (record.version !== 1 || path.resolve(record.project_root || "") !== projectRoot) throw new Error("Recovery journal project is invalid");
    if (!record.plan || record.plan.plan_hash !== record.plan_hash || computePlanHash(record.plan) !== record.plan_hash) throw new Error("Recovery journal plan hash is invalid");
    if (!Number.isInteger(record.completed_count) || record.completed_count < 0 || record.completed_count > record.plan.operations.length) throw new Error("Recovery journal completed count is invalid");
    operations = record.plan.operations.slice(0, record.completed_count);
    for (const operation of operations) validSetupOperation(projectRoot, operation);
    for (const operation of operations) {
      if (operation.type === "mkdir") continue;
      const target = path.join(projectRoot, operation.path);
      if (!fs.existsSync(target)) {
        if (operation.type === "update") errors.push(`${operation.path} is missing`);
        continue;
      }
      const current = fs.readFileSync(target, "utf8");
      if (operation.type === "create" && current !== operation.after) errors.push(`${operation.path} no longer matches the interrupted create`);
      if (operation.type === "update" && current !== operation.before && current !== operation.after) errors.push(`${operation.path} changed after the interrupted update`);
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { valid: errors.length === 0, recovery_hash: recoveryHash, errors, operations };
}

function computePlanHash(plan) {
  const approvedSurface = {
    root: path.resolve(plan.root),
    git: plan.git,
    projectName: plan.projectName,
    contractTracking: plan.contractTracking,
    workspaces: plan.workspaces,
    replaceEntries: plan.replaceEntries,
    operations: plan.operations,
  };
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(approvedSurface)).digest("hex")}`;
}

function normalizeWorkspaces(root, workspaces) {
  const selected = workspaces || [{ id: "default", path: "." }];
  if (!Array.isArray(selected) || selected.length === 0) throw new Error("At least one workspace is required");
  const seen = new Set();
  return selected.map((workspace) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(workspace.id || "") || seen.has(workspace.id)) throw new Error(`Invalid or duplicate workspace id: ${workspace.id}`);
    seen.add(workspace.id);
    const relative = String(workspace.path || "").replaceAll("\\", "/");
    if (!relative || path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative === ".." || relative.startsWith("../")) throw new Error(`Invalid workspace path: ${workspace.path}`);
    assertManagedPath(root, relative);
    if (!fs.existsSync(path.join(root, relative)) || !fs.statSync(path.join(root, relative)).isDirectory()) throw new Error(`Workspace path is not a directory: ${relative}`);
    return { id: workspace.id, path: relative };
  });
}

function planSetup({ root, projectName, contractTracking, workspaces = null, replaceEntries = [], workspaceDecisions = [], manifestRoot, skipLegacy = false } = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }
  if (!skipLegacy && !fs.existsSync(path.join(projectRoot, ".hames/config.yaml"))) {
    const legacy = require("./legacy.js");
    const detection = legacy.detectLegacy(projectRoot, { manifestRoot: manifestRoot || legacy.DEFAULT_MANIFEST_ROOT });
    if (detection.matched) return legacy.planLegacyTransition({ root: projectRoot, manifestRoot: manifestRoot || legacy.DEFAULT_MANIFEST_ROOT, projectName, contractTracking, workspaceDecisions });
  }
  const git = isGitWorkingTree(projectRoot);
  for (const relative of SETUP_MANAGED_PATHS) assertManagedPath(projectRoot, relative);
  const recovery = path.join(projectRoot, ".hames/state/setup-recovery.json");
  if (fs.existsSync(recovery)) {
    return { status: "recovery_required", root: projectRoot, git, operations: [], errors: ["An interrupted setup recovery record exists."] };
  }
  const configPath = path.join(projectRoot, ".hames/config.yaml");
  let existingConfig = null;
  let existingConfigSource = null;
  if (fs.existsSync(configPath)) {
    try {
      existingConfigSource = fs.readFileSync(configPath, "utf8");
      existingConfig = parseConfig(existingConfigSource);
      const validation = validateConfig(existingConfig);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
    } catch (error) {
      return { status: "invalid_config", root: projectRoot, git, operations: [], errors: [`config.yaml: ${error.message}`] };
    }
  }
  if (!contractTracking && existingConfig) contractTracking = existingConfig.tracking.contracts;
  if (!contractTracking) {
    return {
      status: "needs_input",
      root: projectRoot,
      git,
      operations: [],
      questions: [{ id: "contract_tracking", prompt: "Should task contracts be tracked by Git?" }],
    };
  }
  if (!new Set(["tracked", "untracked"]).has(contractTracking)) {
    throw new Error("contractTracking must be 'tracked' or 'untracked'");
  }
  if (!workspaces && existingConfig) {
    workspaces = existingConfig.workspaces.map((id) => {
      const workspaceFile = path.join(projectRoot, ".hames/workspaces", `${id}.yaml`);
      if (!fs.existsSync(workspaceFile)) throw new Error(`Workspace configuration is missing: ${id}`);
      const parsed = parseConfig(fs.readFileSync(workspaceFile, "utf8"));
      return { id, path: parsed.path };
    });
  }
  const selectedWorkspaces = normalizeWorkspaces(projectRoot, workspaces);
  for (const workspace of selectedWorkspaces) assertManagedPath(projectRoot, `.hames/workspaces/${workspace.id}.yaml`);
  const replaceSet = new Set(replaceEntries);

  const operations = [];
  for (const relative of SETUP_MANAGED_PATHS.slice(0, 7)) {
    if (!fs.existsSync(path.join(projectRoot, relative))) operations.push({ type: "mkdir", path: relative });
  }

  if (!fs.existsSync(configPath)) {
    addFileOperation(operations, projectRoot, ".hames/config.yaml", readTemplate("config.yaml", {
      PROJECT_NAME_JSON: JSON.stringify(projectName || path.basename(projectRoot)),
      CONTRACT_TRACKING_JSON: JSON.stringify(contractTracking),
      WORKSPACES_JSON: JSON.stringify(selectedWorkspaces.map((workspace) => workspace.id)),
    }));
  } else if (existingConfig.tracking.contracts !== contractTracking || JSON.stringify(existingConfig.workspaces) !== JSON.stringify(selectedWorkspaces.map((workspace) => workspace.id))) {
    const after = existingConfigSource
      .replace(/^(\s*contracts:\s*).+$/m, `$1${JSON.stringify(contractTracking)}`)
      .replace(/^workspaces:\s*.+$/m, `workspaces: ${JSON.stringify(selectedWorkspaces.map((workspace) => workspace.id))}`);
    addFileOperation(operations, projectRoot, ".hames/config.yaml", after, { update: true });
  }
  for (const workspace of selectedWorkspaces) {
    addFileOperation(operations, projectRoot, `.hames/workspaces/${workspace.id}.yaml`, readTemplate("workspace.yaml", {
      WORKSPACE_ID_JSON: JSON.stringify(workspace.id),
      WORKSPACE_PATH_JSON: JSON.stringify(workspace.path),
      WORKSPACE_CONFIG_JSON: JSON.stringify(`.hames/workspaces/${workspace.id}.yaml`),
    }));
  }
  addFileOperation(operations, projectRoot, ".hames/context/project.md", readTemplate("project.md"));
  for (const [relative, template] of [["AGENTS.md", "AGENTS.block.md"], ["CLAUDE.md", "CLAUDE.block.md"]]) {
    if (replaceSet.has(relative)) addFileOperation(operations, projectRoot, relative, `${readTemplate(template).trimEnd()}\n`, { update: true });
    else addEntryOperation(operations, projectRoot, relative, readTemplate(template));
  }

  if (git) {
    let ignoreBlock = readTemplate("gitignore.block");
    if (contractTracking === "untracked") ignoreBlock = ignoreBlock.replace("{{CONTRACTS_IGNORE}}", ".hames/contracts/");
    else ignoreBlock = ignoreBlock.replace("{{CONTRACTS_IGNORE}}\n", "");
    if (replaceSet.has(".gitignore")) addFileOperation(operations, projectRoot, ".gitignore", `${ignoreBlock.trimEnd()}\n`, { update: true });
    else addEntryOperation(operations, projectRoot, ".gitignore", ignoreBlock);
  }
  const plan = { status: operations.length === 0 ? "configured" : "ready", root: projectRoot, git, projectName: projectName || existingConfig?.project?.name || path.basename(projectRoot), contractTracking, workspaces: selectedWorkspaces, replaceEntries: [...replaceSet].sort(), operations, questions: [] };
  if (plan.status === "ready") plan.plan_hash = computePlanHash(plan);
  return plan;
}

function atomicWrite(file, content, { mode } = {}) {
  const temporary = `${file}.hames-${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const targetMode = mode ?? (fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o644);
  fs.writeFileSync(temporary, content, { mode: targetMode });
  fs.renameSync(temporary, file);
}

function rollback(root, completed) {
  for (const operation of [...completed].reverse()) {
    validSetupOperation(root, operation);
    const target = path.join(root, operation.path);
    if (operation.type === "mkdir") {
      try { fs.rmdirSync(target); } catch {}
    } else if (operation.before === null) {
      fs.rmSync(target, { force: true });
    } else {
      atomicWrite(target, operation.before);
    }
  }
}

function applySetup(plan, { approved = false, failAfter, planHash = null } = {}) {
  if (plan.kind === "legacy_transition") return require("./legacy.js").applyLegacyTransition(plan, { approved, planHash, failAfter });
  if (!approved) return { applied: false, reason: "approval_required" };
  if (plan.status === "configured") return { applied: false, reason: "already_configured" };
  if (plan.status !== "ready") throw new Error(`Setup cannot apply a ${plan.status} plan`);
  if (plan.plan_hash !== computePlanHash(plan)) throw new Error("Setup plan changed after preview; generate and approve a new plan");
  assertPlanIsCurrent(plan);
  const journal = path.join(plan.root, ".hames/state/setup-recovery.json");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const journalBase = { version: 1, project_root: path.resolve(plan.root), plan_hash: plan.plan_hash, plan };
  atomicWrite(journal, `${JSON.stringify({ ...journalBase, completed_count: 0 }, null, 2)}\n`, { mode: 0o600 });
  const completed = [];
  try {
    for (const operation of plan.operations) {
      const target = path.join(plan.root, operation.path);
      atomicWrite(journal, `${JSON.stringify({ ...journalBase, completed_count: completed.length + 1 }, null, 2)}\n`, { mode: 0o600 });
      if (operation.type === "mkdir") fs.mkdirSync(target, { recursive: true });
      else atomicWrite(target, operation.after);
      completed.push(operation);
      if (failAfter && completed.length === failAfter) throw new Error("Simulated setup failure");
    }
    fs.rmSync(journal, { force: true });
    const runtimeParent = path.resolve(__dirname, "..");
    const pluginRoot = fs.existsSync(path.join(runtimeParent, ".codex-plugin")) || fs.existsSync(path.join(runtimeParent, ".claude-plugin")) ? runtimeParent : path.resolve(runtimeParent, "..");
    const verification = require("./doctor.js").diagnose(plan.root, { pluginRoot });
    if (!verification.ok) {
      throw new Error(`Setup verification failed: ${verification.checks.filter((item) => item.status === "fail").map((item) => item.id).join(", ")}`);
    }
    return { applied: true, changed: completed.map((item) => item.path), verification };
  } catch (error) {
    const recovery = fs.existsSync(journal) ? previewSetupRecovery(plan.root) : { valid: true, operations: completed };
    if (recovery.valid) rollback(plan.root, recovery.operations);
    fs.rmSync(journal, { force: true });
    throw error;
  }
}

function recoverSetup(root, { approved = false, recoveryHash = null } = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  const preview = previewSetupRecovery(projectRoot);
  if (!preview.recovery_hash) return { recovered: false, reason: "no_recovery_record" };
  if (!approved) return { recovered: false, reason: "approval_required", preview };
  if (!preview.valid) throw new Error(`Recovery journal is invalid: ${preview.errors.join("; ")}`);
  if (recoveryHash !== preview.recovery_hash) throw new Error("Recovery record changed after preview");
  const journal = path.join(projectRoot, ".hames/state/setup-recovery.json");
  rollback(projectRoot, preview.operations);
  fs.rmSync(journal, { force: true });
  return { recovered: true };
}

function cliArguments(argv) {
  const result = { command: argv[0] || "plan" };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--approved") result.approved = true;
    else if (key.startsWith("--")) result[key.slice(2)] = argv[++index];
  }
  return result;
}

if (require.main === module) {
  try {
    const args = cliArguments(process.argv.slice(2));
    if (args.command === "recover") console.log(JSON.stringify(recoverSetup(args.root, { approved: args.approved, recoveryHash: args["recovery-hash"] }), null, 2));
    else {
      const workspaceDecisions = args["workspace-decisions"] ? JSON.parse(fs.readFileSync(args["workspace-decisions"], "utf8")) : [];
      const plan = planSetup({ root: args.root, projectName: args["project-name"], contractTracking: args.contracts, workspaceDecisions, manifestRoot: args["manifest-root"] });
      if (args.command === "apply" && (!args["plan-hash"] || args["plan-hash"] !== plan.plan_hash)) {
        throw new Error("Apply requires the exact plan hash shown in the approved preview");
      }
      const output = args.command === "apply"
        ? plan.kind === "legacy_transition"
          ? require("./legacy.js").applyLegacyTransition(plan, { approved: args.approved, planHash: args["plan-hash"] })
          : applySetup(plan, { approved: args.approved })
        : plan;
      console.log(JSON.stringify(output, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { applySetup, mergeBlock, planSetup, previewSetupRecovery, recoverSetup };
