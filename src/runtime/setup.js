#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  parseConfig,
  validateConfig,
  validateWorkspace,
  isRelative,
  validId,
  insideRoot,
} = require("./config.js");

const TEMPLATE_ROOT = path.resolve(__dirname, "../templates");
const HAMES_START = "<!-- HAMES:START -->";
const SETUP_MANAGED_PATHS = [
  ".hames", ".hames/workspaces", ".hames/context", ".hames/contracts",
  ".hames/contracts/active", ".hames/contracts/archive", ".hames/state",
  ".hames/config.yaml", ".hames/workspaces/default.yaml", ".hames/context/project.md",
  ".hames/state/setup-recovery.json", "AGENTS.md", "CLAUDE.md", ".gitignore",
];
const DEFAULT_CRITICAL_ACTIONS = ["delete", "destructive_overwrite", "send", "publish", "deploy", "payment", "permission_change", "external_mutation"];
const DEFAULT_FEATURES = ["setup", "ready", "go", "index", "doctor"];
const STANDARD_SETUP_PATHS = new Set([...SETUP_MANAGED_PATHS, "docs/standards.md"]);

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
  const startCount = existing.split(start).length - 1, endCount = existing.split(end).length - 1;
  if (startCount > 1 || endCount > 1 || startCount !== endCount) throw new Error("Duplicate or damaged Hames entry markers");
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

function jsonValue(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function renderConfig(config) {
  return readTemplate("config.yaml", {
    PROJECT_NAME_JSON: jsonValue(config.project.name),
    WORKSPACES_JSON: jsonValue(config.workspaces),
    CONTRACT_TRACKING_JSON: jsonValue(config.tracking.contracts),
    CRITICAL_ACTIONS_JSON: jsonValue(config.guards.critical_actions),
    FEATURES_JSON: jsonValue(config.features),
    DOCUMENTS_JSON: jsonValue(config.documents || []),
    EXCLUDE_JSON: jsonValue(config.exclude || []),
  });
}

function renderWorkspace(workspace) {
  return readTemplate("workspace.yaml", {
    WORKSPACE_ID_JSON: jsonValue(workspace.id),
    WORKSPACE_PATH_JSON: jsonValue(workspace.path),
    WORKSPACE_NAME_JSON: jsonValue(workspace.name),
    WORKSPACE_PURPOSE_JSON: jsonValue(workspace.purpose),
    FOLDERS_JSON: jsonValue(workspace.folders || []),
    RULES_JSON: jsonValue(workspace.rules || []),
    EXCLUDE_JSON: jsonValue(workspace.exclude || []),
    CONTEXT_JSON: jsonValue(workspace.context || []),
    PROTECT_JSON: jsonValue(workspace.protect || []),
    WORKSPACE_CONFIG_JSON: jsonValue(`.hames/workspaces/${workspace.id}.yaml`),
  });
}

function normalizePathValue(value, label) {
  if (typeof value !== "string" || value.includes("\\") || !isRelative(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function normalizeWorkspacePath(value) {
  const relative = normalizePathValue(value, "workspace path");
  if (relative === "docs" || relative.startsWith("docs/") || relative === ".hames" || relative.startsWith(".hames/") || relative === ".git" || relative.startsWith(".git/")) {
    throw new Error(`Workspace path is reserved: ${relative}`);
  }
  return relative;
}

function workspaceLocalPath(workspacePath, value, label) {
  const local = normalizePathValue(value || ".", label);
  if (local === ".") return workspacePath;
  return workspacePath === "." ? local : `${workspacePath}/${local}`;
}

function defaultProtect(id) {
  return [".hames/config.yaml", `.hames/workspaces/${id}.yaml`];
}

function normalizeFolders(rawFolders, compatibility = false) {
  if (rawFolders === undefined || rawFolders === null) return [];
  if (!Array.isArray(rawFolders)) throw new Error("Workspace folders must be an array");
  return rawFolders.map((folder, index) => {
    if (typeof folder === "string") folder = { path: folder, purpose: compatibility ? folder : "" };
    const purpose = typeof folder?.purpose === "string" ? folder.purpose.trim() : "";
    if (!purpose) throw new Error(`Folder ${index + 1} purpose is required`);
    return { path: normalizePathValue(folder.path || ".", "folder path"), purpose };
  });
}

function normalizeRules(rawRules) {
  if (rawRules === undefined || rawRules === null) return [];
  if (!Array.isArray(rawRules)) throw new Error("Workspace rules must be an array");
  return rawRules.map((rule) => ({
    id: rule?.id,
    kind: rule?.kind,
    path: rule?.path || ".",
    value: rule?.value,
  }));
}

function normalizeWorkspaceChoice(raw, root, index, { compatibility = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Workspace ${index + 1} must be a mapping`);
  const id = raw.id || raw.registration_name || raw.registrationName;
  if (!validId(id) || id === "common") throw new Error(`Invalid workspace id: ${id}`);
  const workspacePath = normalizeWorkspacePath(raw.path);
  assertManagedPath(root, workspacePath);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const purpose = typeof raw.purpose === "string" && raw.purpose.trim()
    ? raw.purpose.trim()
    : compatibility ? `${name} workspace` : "";
  if (!purpose) throw new Error(`Workspace ${id} purpose is required`);
  const context = raw.context === undefined ? [] : raw.context;
  const protect = raw.protect === undefined ? defaultProtect(id) : raw.protect;
  const workspace = {
    version: 2,
    id,
    path: workspacePath,
    name,
    purpose,
    folders: normalizeFolders(raw.folders, compatibility),
    rules: normalizeRules(raw.rules),
    exclude: raw.exclude === undefined ? [] : raw.exclude,
    context,
    protect,
  };
  const checked = validateWorkspace(workspace);
  if (!checked.valid) throw new Error(`Workspace ${id}: ${checked.errors.join("; ")}`);
  for (const relative of [...workspace.context, ...workspace.protect]) assertManagedPath(root, relative);
  return workspace;
}

function canonicalWorkspaces(workspaces) {
  return workspaces.map((item) => ({
    ...item,
    folders: item.folders || [],
    rules: item.rules || [],
    exclude: item.exclude || [],
    context: item.context || [],
    protect: item.protect || [],
  }));
}

function workspaceDirectories(workspaces) {
  const output = new Set([".", "docs"]);
  for (const workspace of workspaces) {
    output.add(workspace.path);
    for (const folder of workspace.folders || []) output.add(workspaceLocalPath(workspace.path, folder.path, "folder path"));
  }
  return [...output].filter((relative) => relative !== ".").sort((a, b) => {
    const depth = (value) => value.split("/").length;
    return depth(a) - depth(b) || a.localeCompare(b);
  });
}

function addDirectoryOperations(operations, root, directories) {
  const known = new Set(operations.filter((operation) => operation.type === "mkdir").map((operation) => operation.path));
  for (const relative of directories) {
    assertManagedPath(root, relative);
    if (!fs.existsSync(path.join(root, relative)) && !known.has(relative)) {
      operations.push({ type: "mkdir", path: relative });
      known.add(relative);
    }
  }
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

function plannedDirectories(plan) {
  const directories = new Set([".", "docs", ...workspaceDirectories(plan.workspaces || [])]);
  for (const operation of plan.operations || []) {
    if (operation.type === "mkdir") directories.add(operation.path);
    if (operation.path.endsWith("/_Index.md")) directories.add(path.posix.dirname(operation.path));
  }
  return directories;
}

function allowedSetupPath(relative, plan = null) {
  if (STANDARD_SETUP_PATHS.has(relative)) return true;
  if (/^\.hames\/workspaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.yaml$/.test(relative)) return true;
  if (relative === "_Index.md" || relative === "docs/_Index.md" || (relative.endsWith("/_Index.md") && plannedDirectories(plan || { workspaces: [], operations: [] }).has(path.posix.dirname(relative)))) return true;
  if (plan && plannedDirectories(plan).has(relative)) return true;
  return false;
}

function validateSetupOperation(root, operation, plan = null) {
  if (!operation || !new Set(["mkdir", "create", "update"]).has(operation.type)) throw new Error("Setup plan contains an invalid operation type");
  const canonical = typeof operation.path === "string" && !operation.path.includes("\\") ? path.posix.normalize(operation.path) : null;
  if (!canonical || canonical !== operation.path || !allowedSetupPath(canonical, plan)) throw new Error(`Setup plan contains an unapproved path: ${operation.path}`);
  assertManagedPath(root, operation.path);
  if (operation.type === "mkdir" && (operation.before !== undefined || operation.after !== undefined)) throw new Error("Setup mkdir operation is invalid");
  if (operation.type === "create" && (operation.before !== null || typeof operation.after !== "string")) throw new Error("Setup create operation is invalid");
  if (operation.type === "update" && (typeof operation.before !== "string" || typeof operation.after !== "string")) throw new Error("Setup update operation is invalid");
}

function assertPlanIsCurrent(plan) {
  const paths = new Set();
  for (const operation of plan.operations) {
    validateSetupOperation(plan.root, operation, plan);
    if (paths.has(operation.path)) throw new Error(`Setup plan contains duplicate operation: ${operation.path}`);
    paths.add(operation.path);
    const target = path.join(plan.root, operation.path);
    if (operation.type === "mkdir" && fs.existsSync(target)) throw new Error(`Project changed after preview: ${operation.path} now exists`);
    if (operation.type === "create" && fs.existsSync(target)) throw new Error(`Project changed after preview: ${operation.path} now exists`);
    if (operation.type === "update" && (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== operation.before)) {
      throw new Error(`Project changed after preview: ${operation.path} is stale`);
    }
  }
}

function validSetupOperation(root, operation, plan = null) {
  try {
    validateSetupOperation(root, operation, plan);
  } catch (error) {
    throw new Error(`Recovery journal contains an invalid operation: ${error.message}`);
  }
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
    for (const operation of record.plan.operations) validSetupOperation(projectRoot, operation, record.plan);
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
    config: plan.config,
    workspaces: canonicalWorkspaces(plan.workspaces || []),
    workspaceConfigs: plan.workspaceConfigs,
    documents: plan.documents,
    exclude: plan.exclude,
    replaceEntries: plan.replaceEntries,
    operations: plan.operations,
    upgrade: plan.upgrade,
  };
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(approvedSurface)).digest("hex")}`;
}

function normalizeWorkspaces(root, workspaces, { compatibility = false } = {}) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) throw new Error("At least one workspace is required");
  const seen = new Set();
  const selected = workspaces.map((item, index) => {
    const workspace = normalizeWorkspaceChoice(item, root, index, { compatibility });
    if (seen.has(workspace.id)) throw new Error(`Invalid or duplicate workspace id: ${workspace.id}`);
    seen.add(workspace.id);
    return workspace;
  });
  const paths = new Map();
  for (const workspace of selected) {
    const key = workspace.path.normalize("NFC").toLowerCase();
    if (paths.has(key)) throw new Error(`Conflicting workspace paths: ${workspace.path}`);
    paths.set(key, workspace.id);
  }
  return selected;
}

function readExistingWorkspace(root, id) {
  const file = path.join(root, ".hames/workspaces", `${id}.yaml`);
  if (!fs.existsSync(file)) throw new Error(`Workspace configuration is missing: ${id}`);
  const parsed = parseConfig(fs.readFileSync(file, "utf8"));
  if (parsed.id !== id || typeof parsed.path !== "string") throw new Error(`Workspace identity is invalid: ${id}`);
  return parsed;
}

function existingWorkspaceChoices(root, config) {
  return config.workspaces.map((id) => readExistingWorkspace(root, id));
}

function activeContractEntries(root) {
  const active = path.join(root, ".hames/contracts/active");
  if (!fs.existsSync(active)) return [];
  const entries = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      entries.push(relative);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(directory, entry.name), relative);
    }
  }
  walk(active);
  return entries;
}

function buildQuestions({ git, contractTracking, workspaceChoices }) {
  const questions = [];
  if (!contractTracking && git) questions.push({ id: "contract_tracking", prompt: "Should task contracts be tracked by Git?", choices: ["tracked", "untracked"] });
  if (!workspaceChoices) questions.push({ id: "workspace", prompt: "Choose at least one workspace path, name, purpose, and folder role before setup can continue." });
  return questions;
}

function fallbackIndex(root, directory, children) {
  const file = directory === "." ? "_Index.md" : `${directory}/_Index.md`;
  const target = path.join(root, file);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  const heading = before || `# ${directory === "." ? "Workspace map" : path.posix.basename(directory)}\n\n`;
  const rows = ["<!-- HAMES:INDEX:START -->", "| Item | Path | Purpose | Scope |", "|---|---|---|---|"];
  for (const child of children) {
    const childPath = child === "." ? child : child;
    const relative = path.posix.relative(directory, childPath);
    const link = `./${relative ? `${relative}/` : ""}_Index.md`;
    rows.push(`| ${path.posix.basename(childPath)} | [open](${link}) | Purpose not yet configured | root |`);
  }
  rows.push("<!-- HAMES:INDEX:END -->");
  const marker = /<!-- HAMES:INDEX:START -->[\s\S]*?<!-- HAMES:INDEX:END -->/;
  const after = marker.test(heading) ? heading.replace(marker, rows.join("\n")) : `${heading.trimEnd()}\n\n${rows.join("\n")}\n`;
  return { type: before === null ? "create" : "update", path: file, before, after };
}

function buildIndexPreview(root, config, workspaces, directories) {
  let helper;
  try { helper = require("./index.js"); } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return [];
    throw error;
  }
  const project = { root: path.resolve(root), config, workspaces };
  const existingDirectories = directories.filter((relative) => fs.existsSync(path.join(root, relative)));
  let operations;
  try {
    operations = helper.buildIndexPlan(root, { project, extraDirectories: directories });
  } catch (error) {
    if (!/ENOENT|no such file|Invalid relative path/i.test(error.message)) throw error;
    operations = helper.buildIndexPlan(root, { project, extraDirectories: existingDirectories });
  }
  const planned = new Set(operations.map((operation) => operation.path));
  const childrenByDirectory = new Map();
  for (const directory of directories) {
    const parent = path.posix.dirname(directory);
    if (parent === directory) continue;
    if (!childrenByDirectory.has(parent)) childrenByDirectory.set(parent, []);
    childrenByDirectory.get(parent).push(directory);
  }
  for (const directory of [".", ...directories]) {
    const file = directory === "." ? "_Index.md" : `${directory}/_Index.md`;
    if (!planned.has(file) && !fs.existsSync(path.join(root, file))) {
      operations.push(fallbackIndex(root, directory, childrenByDirectory.get(directory) || []));
    }
  }
  return operations;
}

function indexLink(relative, directory) {
  const target = relative.endsWith("/") ? `${relative}_Index.md` : relative;
  const value = path.posix.relative(directory, target);
  return `./${value.split("/").map(encodeURIComponent).join("/")}`;
}

function plannedIndexPurpose(config, workspaces, relative) {
  const registered = (config.documents || []).find(d => d.path === relative);
  if (registered) return {purpose: registered.purpose, scope: registered.scope};
  if (relative === "docs" || relative.startsWith("docs/")) return { purpose: "Shared operating documents", scope: "system" };
  const selected = workspaces.filter((workspace) => workspace.path === "." || relative === workspace.path || relative.startsWith(`${workspace.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  if (!selected) return { purpose: "Purpose not yet configured", scope: "root" };
  const local = selected.path === "." ? relative : relative.slice(selected.path.length + 1);
  const folder = (selected.folders || []).filter((item) => local === item.path || local.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  return { purpose: folder?.purpose || selected.purpose, scope: selected.id };
}

function augmentIndexOperations(root, config, workspaces, indexOperations, setupOperations) {
  const byPath = new Map(indexOperations.map((operation) => [operation.path, operation]));
  for (const source of setupOperations) {
    const target = source.type === "mkdir" ? `${source.path}/_Index.md` : source.path;
    if (target.endsWith("/_Index.md") || target === "_Index.md") continue;
    const directory = path.posix.dirname(target);
    const indexPath = directory === "." ? "_Index.md" : `${directory}/_Index.md`;
    const operation = byPath.get(indexPath);
    if (!operation) continue;
    const expected = source.type === "mkdir" ? `${source.path}/_Index.md` : source.path;
    const url = indexLink(expected, directory);
    if (operation.after.includes(`](${url})`)) continue;
    const item = source.type === "mkdir" ? path.posix.basename(source.path) : path.posix.basename(source.path);
    const meta = plannedIndexPurpose(config, workspaces, source.path);
    const row = `| ${item.replace(/\|/g, "&#124;")} | [open](${url}) | ${meta.purpose.replace(/[\r\n|]/g, " ")} | ${meta.scope} |`;
    const marker = "<!-- HAMES:INDEX:END -->";
    operation.after = operation.after.replace(marker, `${row}\n${marker}`);
  }
  for (const operation of byPath.values()) {
    const start = operation.after.indexOf("<!-- HAMES:INDEX:START -->");
    const end = operation.after.indexOf("<!-- HAMES:INDEX:END -->", start);
    if (start < 0 || end < 0) continue;
    const block = operation.after.slice(start, end);
    const lines = block.split("\n");
    const head = lines.slice(0, 3);
    const rows = lines.slice(3).filter(Boolean).sort((a, b) => a.localeCompare(b));
    operation.after = `${operation.after.slice(0, start)}${[...head, ...rows].join("\n")}\n${operation.after.slice(end)}`;
  }
  return [...byPath.values()];
}

function configFor({ projectName, contractTracking, workspaces, existingConfig, documents, exclude }) {
  const guards = existingConfig?.guards || { enabled: true, critical_actions: DEFAULT_CRITICAL_ACTIONS };
  return {
    version: 2,
    project: { name: projectName || existingConfig?.project?.name, root: "." },
    workspaces: workspaces.map((workspace) => workspace.id),
    tracking: { contracts: contractTracking },
    guards,
    features: DEFAULT_FEATURES,
    extensions: existingConfig?.extensions || {},
    documents: documents || existingConfig?.documents || [{ path: "docs/standards.md", purpose: "Shared workspace operating rules", scope: "common", depends: [] }],
    exclude: exclude || existingConfig?.exclude || [],
  };
}

function planSetup({
  root,
  projectName,
  contractTracking,
  workspaces = null,
  replaceEntries = [],
  workspaceDecisions = [],
  documents = null,
  exclude = null,
  manifestRoot,
  skipLegacy = false,
  interactive = true,
  compatibility = false,
} = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }
  if (!skipLegacy && !fs.existsSync(path.join(projectRoot, ".hames/config.yaml"))) {
    const legacy = require("./legacy.js");
    const detection = legacy.detectLegacy(projectRoot, { manifestRoot: manifestRoot || legacy.DEFAULT_MANIFEST_ROOT });
    if (detection.matched) {
      const legacyTracking = contractTracking || (!isGitWorkingTree(projectRoot) ? "untracked" : null);
      return legacy.planLegacyTransition({ root: projectRoot, manifestRoot: manifestRoot || legacy.DEFAULT_MANIFEST_ROOT, projectName, contractTracking: legacyTracking, workspaceDecisions });
    }
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
  if (!contractTracking && !git) contractTracking = "untracked";
  if (contractTracking && !new Set(["tracked", "untracked"]).has(contractTracking)) throw new Error("contractTracking must be 'tracked' or 'untracked'");

  const activeContracts = existingConfig?.version === 1 ? activeContractEntries(projectRoot) : [];
  if (activeContracts.length) {
    return { status: "legacy_active_contracts", root: projectRoot, git, operations: [], errors: ["Active v1 contracts require completion or handoff before setup can upgrade this project."], active_contracts: activeContracts };
  }

  let rawChoices = workspaces;
  if (!rawChoices && Array.isArray(workspaceDecisions) && workspaceDecisions.length) rawChoices = workspaceDecisions;
  if (!rawChoices && existingConfig) rawChoices = existingWorkspaceChoices(projectRoot, existingConfig);

  const questions = buildQuestions({ git, contractTracking, workspaceChoices: rawChoices });
  if (questions.length) return { status: "needs_input", root: projectRoot, git, contractTracking, operations: [], questions };
  const selectedWorkspaces = normalizeWorkspaces(projectRoot, rawChoices, { compatibility: compatibility || (existingConfig?.version === 1 && !workspaces && !workspaceDecisions.length) });
  for (const workspace of selectedWorkspaces) assertManagedPath(projectRoot, `.hames/workspaces/${workspace.id}.yaml`);
  const replaceSet = new Set(replaceEntries);
  for (const relative of replaceSet) {
    if (!["AGENTS.md", "CLAUDE.md", ".gitignore"].includes(relative)) throw new Error(`Cannot replace unmanaged setup entry: ${relative}`);
  }
  const projectNameValue = projectName || existingConfig?.project?.name || path.basename(projectRoot);
  const selected = canonicalWorkspaces(selectedWorkspaces);
  const config = configFor({ projectName: projectNameValue, contractTracking, workspaces: selected, existingConfig, documents, exclude });
  const configValidation = validateConfig(config);
  if (!configValidation.valid) throw new Error(`Generated configuration is invalid: ${configValidation.errors.join("; ")}`);
  const operations = [];
  addDirectoryOperations(operations, projectRoot, [
    ".hames", ".hames/workspaces", ".hames/contracts", ".hames/contracts/active", ".hames/contracts/archive", ".hames/state",
    ...workspaceDirectories(selected),
  ]);
  const configText = `${renderConfig(config).trimEnd()}\n`;
  if (!existingConfig || existingConfig.version !== 2 || JSON.stringify(existingConfig) !== JSON.stringify(config)) {
    addFileOperation(operations, projectRoot, ".hames/config.yaml", configText, { update: Boolean(existingConfig) });
  }
  const workspaceConfigs = {};
  for (const workspace of selected) {
    workspaceConfigs[workspace.id] = workspace;
    const file = `.hames/workspaces/${workspace.id}.yaml`;
    const existingWorkspace = fs.existsSync(path.join(projectRoot, file)) ? parseConfig(fs.readFileSync(path.join(projectRoot, file), "utf8")) : null;
    if (!existingWorkspace || existingWorkspace.version !== 2 || JSON.stringify(existingWorkspace) !== JSON.stringify(workspace)) {
      addFileOperation(operations, projectRoot, file, `${renderWorkspace(workspace).trimEnd()}\n`, { update: Boolean(existingWorkspace) });
    }
  }
  if (config.documents.some(d => d.path === "docs/standards.md")) addFileOperation(operations, projectRoot, "docs/standards.md", readTemplate("project.md"));
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
  const indexDirectories = workspaceDirectories(selected);
  let indexOperations = buildIndexPreview(projectRoot, config, selected, indexDirectories);
  indexOperations = augmentIndexOperations(projectRoot, config, selected, indexOperations, operations);
  const operationPaths = new Set(operations.map((operation) => operation.path));
  for (const operation of indexOperations) {
    if (operationPaths.has(operation.path)) throw new Error(`Setup and index plans overlap: ${operation.path}`);
    operations.push(operation);
    operationPaths.add(operation.path);
  }
  const plan = {
    kind: "setup",
    status: operations.length === 0 ? "configured" : "ready",
    root: projectRoot,
    git,
    projectName: projectNameValue,
    contractTracking,
    config,
    documents: config.documents,
    exclude: config.exclude,
    workspaces: selected,
    workspaceConfigs,
    replaceEntries: [...replaceSet].sort(),
    operations,
    index_operations: indexOperations,
    questions: [],
    upgrade: existingConfig?.version === 1 ? { from: 1, to: 2, archived_contracts_preserved: true } : null,
  };
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

function rollback(root, completed, plan = null) {
  const remaining = [];
  for (const operation of [...completed].reverse()) {
    validSetupOperation(root, operation, plan);
    const target = path.join(root, operation.path);
    try {
      if (operation.type === "mkdir") {
        if (fs.existsSync(target)) fs.rmdirSync(target);
      } else if (operation.before === null) {
        if (!fs.existsSync(target)) continue;
        if (fs.readFileSync(target, "utf8") !== operation.after) { remaining.push(operation.path); continue; }
        fs.rmSync(target, { force: true });
      } else {
        if (!fs.existsSync(target)) { remaining.push(operation.path); continue; }
        const current = fs.readFileSync(target, "utf8");
        if (current === operation.before) continue;
        if (current !== operation.after) { remaining.push(operation.path); continue; }
        atomicWrite(target, operation.before);
      }
    } catch (error) {
      if (operation.type === "mkdir" && ["ENOTEMPTY", "ENOENT", "EEXIST"].includes(error.code)) continue;
      remaining.push(operation.path);
    }
  }
  return { remaining };
}

function verifySetupResult(root, plan) {
  const checks = [];
  try {
    const config = parseConfig(fs.readFileSync(path.join(root, ".hames/config.yaml"), "utf8"));
    const checked = validateConfig(config);
    checks.push({ id: "config", status: checked.valid ? "pass" : "fail", detail: checked.errors.join("; ") });
    for (const id of config.workspaces) {
      const workspace = parseConfig(fs.readFileSync(path.join(root, `.hames/workspaces/${id}.yaml`), "utf8"));
      const result = validateWorkspace(workspace);
      checks.push({ id: `workspace:${id}`, status: result.valid ? "pass" : "fail", detail: result.errors.join("; ") });
    }
  } catch (error) {
    checks.push({ id: "config", status: "fail", detail: error.message });
  }
  for (const relative of [".hames/workspaces", ".hames/contracts/active", ".hames/contracts/archive", ".hames/state", "docs"]) {
    checks.push({ id: `path:${relative}`, status: fs.existsSync(path.join(root, relative)) ? "pass" : "fail", detail: relative });
  }
  return { ok: checks.every((item) => item.status !== "fail"), project_root: root, plan_hash: plan.plan_hash, checks };
}

function applySetup(plan, { approved = false, failAfter, planHash = null } = {}) {
  if (plan.kind === "legacy_transition") return require("./legacy.js").applyLegacyTransition(plan, { approved, planHash, failAfter });
  if (!approved) return { applied: false, reason: "approval_required" };
  if (plan.status === "configured") return { applied: false, reason: "already_configured" };
  if (plan.status !== "ready") throw new Error(`Setup cannot apply a ${plan.status} plan`);
  if (planHash !== null && planHash !== plan.plan_hash) throw new Error("Setup plan hash changed after preview");
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
      atomicWrite(journal, `${JSON.stringify({ ...journalBase, completed_count: completed.length }, null, 2)}\n`, { mode: 0o600 });
      if (operation.type === "mkdir") fs.mkdirSync(target, { recursive: true });
      else atomicWrite(target, operation.after);
      completed.push(operation);
      atomicWrite(journal, `${JSON.stringify({ ...journalBase, completed_count: completed.length }, null, 2)}\n`, { mode: 0o600 });
      if (failAfter && completed.length === failAfter) throw new Error("Simulated setup failure");
    }
    const verification = verifySetupResult(plan.root, plan);
    if (!verification.ok) {
      throw new Error(`Setup verification failed: ${verification.checks.filter((item) => item.status === "fail").map((item) => item.id).join(", ")}`);
    }
    fs.rmSync(journal, { force: true });
    return { applied: true, changed: completed.map((item) => item.path), verification };
  } catch (error) {
    const recovery = fs.existsSync(journal) ? previewSetupRecovery(plan.root) : { valid: true, operations: completed };
    const rolled = recovery.valid ? rollback(plan.root, recovery.operations, plan) : { remaining: recovery.operations.map((operation) => operation.path) };
    if (!rolled.remaining.length) fs.rmSync(journal, { force: true });
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
  const record = JSON.parse(fs.readFileSync(journal, "utf8"));
  const rolled = rollback(projectRoot, preview.operations, record.plan);
  if (rolled.remaining.length) return { recovered: false, reason: "user_changes_preserved", remaining: rolled.remaining };
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

function readDecisionInput(file) {
  if (!file) return {};
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(value)) return { workspaceDecisions: value };
  if (!value || typeof value !== "object") throw new Error("Setup input must be a JSON object or workspace array");
  return {
    projectName: value.projectName ?? value.project_name,
    contractTracking: value.contractTracking ?? value.contract_tracking,
    workspaces: value.workspaces,
    workspaceDecisions: value.workspaceDecisions ?? value.workspace_decisions ?? value.decisions,
    documents: value.documents,
    exclude: value.exclude,
    replaceEntries: value.replaceEntries ?? value.replace_entries,
  };
}

if (require.main === module) {
  try {
    const args = cliArguments(process.argv.slice(2));
    if (args.command === "recover") console.log(JSON.stringify(recoverSetup(args.root, { approved: args.approved, recoveryHash: args["recovery-hash"] }), null, 2));
    else {
      const input = readDecisionInput(args.input || args["workspace-decisions"]);
      const plan = planSetup({
        root: args.root,
        projectName: args["project-name"] ?? input.projectName,
        contractTracking: args.contracts ?? input.contractTracking,
        workspaces: input.workspaces,
        workspaceDecisions: input.workspaceDecisions || [],
        documents: input.documents,
        exclude: input.exclude,
        replaceEntries: input.replaceEntries || [],
        manifestRoot: args["manifest-root"],
        interactive: true,
      });
      if (args.command === "apply" && (!args["plan-hash"] || args["plan-hash"] !== plan.plan_hash)) {
        throw new Error("Apply requires the exact plan hash shown in the approved preview");
      }
      const output = args.command === "apply"
          ? plan.kind === "legacy_transition"
            ? require("./legacy.js").applyLegacyTransition(plan, { approved: args.approved, planHash: args["plan-hash"] })
          : applySetup(plan, { approved: args.approved, planHash: args["plan-hash"] })
        : plan;
      console.log(JSON.stringify(output, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { computePlanHash, applySetup, mergeBlock, planSetup, previewSetupRecovery, recoverSetup };
