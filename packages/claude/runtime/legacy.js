#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_MANIFEST_ROOT = path.resolve(__dirname, "../legacy/manifests");
const SUPPORTED_COMMITS = [
  "e79ec568e38cc1820045d5b2969ad3ff9e942d62",
  "5e64259a679fa7686e0305503c6aebf9288b8efd",
  "1dbc650da704ea204e0bf8d3c45ab1810d417fe2",
  "461ea88f9972e5ce31a1a57a06334f9df23eb96c",
  "349e4e8f743d395a1f7b66c759478c1e7604f38e",
  "8d8bdbe4e860197e6a806fced910953f1f3e4569",
  "958a15c97aac9f63e813103125b705aebb06473a",
  "91cabd66aa0cd1558e2e6c738ec6c0baa97b5525",
  "3f2d2db7554cf80966a81df91539225b4f87dd43",
];
const ENTRY_PATHS = new Set(["AGENTS.md", "CLAUDE.md", ".gitignore"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(canonicalize(value)));
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function matchesFileDigest(content, expected) {
  if (digest(content) === expected) return true;
  if (!Buffer.isBuffer(content) || content.includes(0)) return false;
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) return false;
  return digest(Buffer.from(text.replace(/\r\n/g, "\n"), "utf8")) === expected;
}

function manifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.manifest_digest;
  return digest(copy);
}

function normalizeRelative(relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\")) throw new Error(`Invalid legacy path: ${relative}`);
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) throw new Error(`Unsafe legacy path: ${relative}`);
  return normalized;
}

function isProtectedPath(relative) {
  const normalized = relative.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  const basename = parts.at(-1);
  if (parts.some((part) => new Set([".git", ".ssh", ".aws", "secrets"]).has(part))) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && !basename.includes("example"))) return true;
  if (!basename.includes("example") && /(credential|secret|token)/.test(basename)) return true;
  if (/\.(pem|key|p12|pfx)$/.test(basename) || new Set(["id_rsa", "id_ed25519", ".npmrc", ".netrc"]).has(basename)) return true;
  return false;
}

function runGit(root, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", root, ...args], { encoding });
  return result.status === 0 ? result.stdout : null;
}

function loadManifests(manifestRoot = DEFAULT_MANIFEST_ROOT) {
  const registry = JSON.parse(fs.readFileSync(path.join(manifestRoot, "registry.json"), "utf8"));
  const manifests = registry.manifests.map((name) => JSON.parse(fs.readFileSync(path.join(manifestRoot, name), "utf8")));
  for (const manifest of manifests) {
    if (manifest.version !== 1 || manifest.manifest_digest !== manifestDigest(manifest)) throw new Error(`Legacy manifest integrity check failed: ${manifest.id}`);
    for (const entry of manifest.files) normalizeRelative(entry.path);
  }
  return manifests;
}

function normalizedOrigin(value) {
  return String(value || "").trim().toLowerCase().replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
}

function signatureMatch(root, manifest) {
  let matches = 0;
  let kernel = false;
  for (const signature of manifest.signatures) {
    const file = path.join(root, signature.path);
    if (!fs.existsSync(file) || isProtectedPath(signature.path) || !fs.lstatSync(file).isFile()) continue;
    const content = fs.readFileSync(file);
    if (matchesFileDigest(content, signature.sha256)) matches += 1;
    if (signature.kernel_marker && content.toString("utf8").includes(signature.kernel_marker)) kernel = true;
  }
  return { matches, kernel };
}

function detectLegacy(root, { manifestRoot = DEFAULT_MANIFEST_ROOT } = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  if (fs.existsSync(path.join(projectRoot, ".hames/config.yaml"))) return { matched: false, configured: true, basis: "configured" };
  const currentMarkers = ["src/runtime/legacy.js", "platform/codex/plugin.json", ".agents/plugins/marketplace.json"].filter((relative) => fs.existsSync(path.join(projectRoot, relative)));
  if (currentMarkers.length >= 2) return { matched: false, configured: false, basis: "current_distribution" };
  const manifests = loadManifests(manifestRoot);
  const origin = normalizedOrigin(runGit(projectRoot, ["remote", "get-url", "origin"]));
  const shallow = runGit(projectRoot, ["rev-parse", "--is-shallow-repository"])?.trim() === "true";
  if (origin === "https://github.com/baek-labs/hames" && !shallow) {
    for (const manifest of [...manifests].reverse()) {
      const commit = manifest.commits.at(-1);
      if (runGit(projectRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]) !== null) {
        return { matched: true, configured: false, basis: "git_history", manifest_id: manifest.id, manifest_digest: manifest.manifest_digest, commit };
      }
    }
  }
  const candidates = manifests.map((manifest) => ({ manifest, ...signatureMatch(projectRoot, manifest) })).filter((item) => item.kernel && item.matches >= 3).sort((a, b) => b.matches - a.matches);
  if (!candidates.length || (candidates[1] && candidates[1].matches === candidates[0].matches)) return { matched: false, configured: false, basis: "insufficient_evidence" };
  const selected = candidates[0].manifest;
  return { matched: true, configured: false, basis: "signatures", manifest_id: selected.id, manifest_digest: selected.manifest_digest, commit: selected.commits.at(-1) };
}

function safeResolved(root, relative) {
  const normalized = normalizeRelative(relative);
  const rootReal = fs.realpathSync(root);
  const absolute = path.resolve(root, normalized);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor);
  const escaped = path.relative(rootReal, real);
  if (escaped === ".." || escaped.startsWith(`..${path.sep}`) || path.isAbsolute(escaped)) throw new Error(`Legacy path escapes project: ${relative}`);
  return absolute;
}

function kindOf(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function protectedInventory(root) {
  const protectedItems = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === ".hames") continue;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (isProtectedPath(relative)) {
        protectedItems.push({ path: relative, kind: kindOf(stat), exists: true, classification: "protected" });
        continue;
      }
      if (stat.isDirectory()) walk(absolute, relative);
    }
  }
  walk(root);
  return protectedItems.sort((a, b) => a.path.localeCompare(b.path));
}

function currentEntry(root, entry) {
  const absolute = safeResolved(root, entry.path);
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.lstatSync(absolute);
  const kind = kindOf(stat);
  if (kind === "directory" && entry.kind === "submodule") {
    const revision = runGit(absolute, ["rev-parse", "HEAD"]);
    const dirty = runGit(absolute, ["status", "--porcelain"]);
    return { kind: "submodule", matches: revision?.trim() === entry.revision && dirty === "", current_digest: revision ? digest(revision.trim()) : null };
  }
  if (kind === "symlink") {
    const link = fs.readlinkSync(absolute);
    const target = path.resolve(path.dirname(absolute), link);
    const targetRelative = path.relative(fs.realpathSync(root), target);
    const inside = targetRelative !== ".." && !targetRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(targetRelative);
    return { kind, matches: entry.kind === kind && digest(link) === entry.sha256, current_digest: digest(link), symlink_inside: inside, target_path_digest: digest(target) };
  }
  if (kind !== "file") return { kind, matches: false, current_digest: null };
  const content = fs.readFileSync(absolute);
  const currentDigest = digest(content);
  return { kind, matches: entry.kind === "file" && matchesFileDigest(content, entry.sha256), current_digest: currentDigest };
}

function legacyWorkspaceMappings(root, manifest) {
  const file = path.join(root, ".cursor/rules/context_engineering.md");
  const manifestEntry = manifest.files.find((item) => item.path === ".cursor/rules/context_engineering.md");
  if (!manifestEntry || !fs.existsSync(file) || isProtectedPath(manifestEntry.path) || !currentEntry(root, manifestEntry)?.matches) return new Map();
  const mappings = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`\{\{HAMES_ROOT\}\}\/([^`]+)`/);
    if (match) mappings.set(match[2].replaceAll("\\", "/"), match[1].trim());
  }
  return mappings;
}

function workspaceCandidates(root, manifest, decisions) {
  const manifestPaths = new Set(manifest.files.map((item) => item.path));
  const mappings = legacyWorkspaceMappings(root, manifest);
  const decisionMap = new Map(decisions.map((item) => [normalizeRelative(item.path), item.name]));
  const candidates = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === ".git" || relative === ".hames" || isProtectedPath(relative)) continue;
      const absolute = path.join(directory, entry.name);
      const evidence = ["AGENTS.md", "CLAUDE.md", "package.json", "pyproject.toml", "_Master"].filter((name) => fs.existsSync(path.join(absolute, name)));
      const onlySystem = [...manifestPaths].some((systemPath) => systemPath === relative || systemPath.startsWith(`${relative}/`));
      if (evidence.length && !onlySystem) {
        const mapped = mappings.get(relative);
        const selected = decisionMap.get(relative) || mapped || null;
        if (selected && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(selected)) throw new Error(`Invalid workspace registration name: ${selected}`);
        candidates.push({ path: relative, evidence, registration_name: selected, confirmed: Boolean(selected), source: decisionMap.has(relative) ? "user_confirmation" : mapped ? "legacy_config" : "needs_confirmation" });
      }
      walk(absolute, relative);
    }
  }
  walk(root);
  for (const [relative, name] of decisionMap) {
    if (candidates.some((item) => item.path === relative)) continue;
    if (relative === ".git" || relative === ".hames" || isProtectedPath(relative)) throw new Error(`Unsafe workspace decision path: ${relative}`);
    const absolute = safeResolved(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw new Error(`Confirmed workspace path is not a directory: ${relative}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name || "")) throw new Error(`Invalid workspace registration name: ${name}`);
    candidates.push({ path: relative, evidence: ["user_confirmation"], registration_name: name, confirmed: true, source: "user_confirmation" });
  }
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

function unknownInventory(root, manifestPaths, protectedPaths, candidatePaths) {
  const output = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === ".hames" || protectedPaths.has(relative) || candidatePaths.has(relative)) continue;
      if (relative === ".git") {
        output.push({ path: relative, kind: "directory", exists: true, classification: "git_metadata" });
        continue;
      }
      const exactSystem = manifestPaths.has(relative);
      const systemParent = [...manifestPaths].some((item) => item.startsWith(`${relative}/`));
      if (!exactSystem && !systemParent) {
        output.push({ path: relative, kind: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file", exists: true, classification: "unknown_user" });
        continue;
      }
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
    }
  }
  walk(root);
  return output;
}

function planLegacyTransition({ root, manifestRoot = DEFAULT_MANIFEST_ROOT, projectName, contractTracking, workspaceDecisions = [] }) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  if (fs.existsSync(path.join(projectRoot, ".hames/config.yaml"))) return { status: "configured", root: projectRoot, cleanup: [], preserved: [], workspace_candidates: [], workspace_registrations: [] };
  const detected = detectLegacy(projectRoot, { manifestRoot });
  if (!detected.matched) return { status: "not_legacy", root: projectRoot, detection: detected, cleanup: [], preserved: [], workspace_candidates: [], workspace_registrations: [] };
  if (!contractTracking) return { status: "needs_input", kind: "legacy_transition", root: projectRoot, detection: detected, cleanup: [], preserved: [], workspace_candidates: [], workspace_registrations: [], questions: [{ id: "contract_tracking", prompt: "Should task contracts be tracked by Git?" }] };
  const manifest = loadManifests(manifestRoot).find((item) => item.id === detected.manifest_id);
  const manifestPaths = new Set(manifest.files.map((item) => item.path));
  const protectedItems = protectedInventory(projectRoot);
  const protectedPaths = new Set(protectedItems.map((item) => item.path));
  const cleanup = [];
  const preserved = [...protectedItems];
  for (const entry of manifest.files) {
    if (isProtectedPath(entry.path) || entry.protected) continue;
    const current = currentEntry(projectRoot, entry);
    if (!current) continue;
    if (entry.kind === "submodule") {
      preserved.push({ path: entry.path, kind: current.kind, exists: true, classification: current.matches ? "submodule_preserved" : "modified_submodule" });
    } else if (current.kind === "symlink" && !current.symlink_inside) {
      preserved.push({ path: entry.path, kind: current.kind, exists: true, classification: "external_symlink" });
    } else if (current.matches) {
      cleanup.push({ path: entry.path, kind: current.kind, current_digest: current.current_digest, symlink_inside: current.symlink_inside, target_path_digest: current.target_path_digest, action: ENTRY_PATHS.has(entry.path) ? "replace_entry" : "remove" });
    } else {
      preserved.push({ path: entry.path, kind: current.kind, exists: true, classification: "modified_system", current_digest: current.current_digest });
    }
  }
  const candidates = workspaceCandidates(projectRoot, manifest, workspaceDecisions);
  const registrations = candidates.filter((item) => item.confirmed).map((item) => ({ path: item.path, name: item.registration_name }));
  preserved.push(...unknownInventory(projectRoot, manifestPaths, protectedPaths, new Set(candidates.map((item) => item.path))));
  const setupPlan = require("./setup.js").planSetup({ root: projectRoot, projectName, contractTracking, workspaces: [{ id: "default", path: "." }, ...registrations.map((item) => ({ id: item.name, path: item.path }))], replaceEntries: cleanup.filter((item) => item.action === "replace_entry").map((item) => item.path), skipLegacy: true });
  const hashInput = {
    project_realpath: projectRoot,
    manifest_digest: manifest.manifest_digest,
    detection_basis: detected.basis,
    cleanup: cleanup.map((item) => ({ path: item.path, kind: item.kind, current_digest: item.current_digest, ...(item.kind === "symlink" ? { symlink_inside: item.symlink_inside, target_path_digest: item.target_path_digest } : {}), action: item.action })).sort((a, b) => a.path.localeCompare(b.path)),
    setup_plan_hash: setupPlan.plan_hash,
    workspace_candidates: candidates.map((item) => ({ path: item.path, evidence: item.evidence, registration_name: item.registration_name, confirmed: item.confirmed })).sort((a, b) => a.path.localeCompare(b.path)),
    preserved: preserved.map((item) => item.classification === "protected" ? { path: item.path, kind: item.kind, exists: item.exists, classification: item.classification } : item).sort((a, b) => a.path.localeCompare(b.path)),
    contract_tracking: contractTracking,
  };
  const questions = [
    ...candidates.filter((item) => !item.confirmed).map((item) => ({ id: `workspace:${item.path}`, path: item.path, prompt: "Confirm whether this is a workspace and choose its registration name, or preserve it unregistered." })),
    ...hashInput.preserved.filter((item) => item.classification === "modified_system" || item.classification === "unknown_user").map((item) => ({ id: `preserve:${item.path}`, path: item.path, prompt: "This item is preserved. Confirm its ownership and any later manual handling." })),
  ];
  return { status: "ready", kind: "legacy_transition", root: projectRoot, manifest_id: manifest.id, manifest_digest: manifest.manifest_digest, manifest_root: path.resolve(manifestRoot), detection: detected, cleanup: hashInput.cleanup, preserved: hashInput.preserved, workspace_candidates: candidates, workspace_registrations: registrations, questions, setup_plan: setupPlan, hash_input: hashInput, plan_hash: digest(hashInput) };
}

function planStillCurrent(plan) {
  for (const item of plan.cleanup) {
    const absolute = safeResolved(plan.root, item.path);
    if (!fs.existsSync(absolute)) return false;
    if (item.kind === "file" && digest(fs.readFileSync(absolute)) !== item.current_digest) return false;
    if (item.kind === "symlink" && digest(fs.readlinkSync(absolute)) !== item.current_digest) return false;
  }
  return true;
}

function restoreSetupPlan(plan) {
  for (const operation of [...plan.operations].reverse()) {
    const target = safeResolved(plan.root, operation.path);
    if (operation.type === "mkdir") { try { fs.rmdirSync(target); } catch {} }
    else if (operation.before === null) fs.rmSync(target, { force: true });
    else fs.writeFileSync(target, operation.before);
  }
}

function writeRecovery(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function applyLegacyTransition(plan, { approved = false, planHash = null, failAfter = null } = {}) {
  if (!approved) return { applied: false, reason: "approval_required" };
  if (plan.status === "configured") return { applied: false, reason: "already_configured" };
  if (plan.status !== "ready" || plan.kind !== "legacy_transition") throw new Error("Legacy transition plan is not ready");
  if (planHash !== plan.plan_hash || digest(plan.hash_input) !== plan.plan_hash) throw new Error("Legacy transition plan hash changed after preview");
  if (digest(plan.cleanup) !== digest(plan.hash_input.cleanup) || plan.setup_plan.plan_hash !== plan.hash_input.setup_plan_hash) throw new Error("Legacy transition execution surface differs from the approved plan");
  if (!planStillCurrent(plan)) throw new Error("Legacy files changed after preview; generate a new plan");
  const fresh = planLegacyTransition({ root: plan.root, manifestRoot: plan.manifest_root, projectName: plan.setup_plan.projectName, contractTracking: plan.setup_plan.contractTracking, workspaceDecisions: plan.workspace_registrations });
  if (fresh.plan_hash !== plan.plan_hash) throw new Error("Legacy transition inputs changed after preview");
  const setup = require("./setup.js");
  const removed = [];
  let recoveryFile = null;
  let setupApplied = false;
  try {
    setup.applySetup(plan.setup_plan, { approved: true });
    setupApplied = true;
    const removalPlan = plan.cleanup.filter((entry) => entry.action === "remove").map((item) => {
      const target = safeResolved(plan.root, item.path);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() && !stat.isSymbolicLink()) return null;
      const kind = stat.isSymbolicLink() ? "symlink" : "file";
      const raw = kind === "symlink" ? fs.readlinkSync(target) : fs.readFileSync(target);
      if (digest(raw) !== item.current_digest) throw new Error(`Legacy file changed before cleanup: ${item.path}`);
      return { path: item.path, content: kind === "symlink" ? raw : raw.toString("base64"), kind, mode: stat.mode & 0o777, current_digest: item.current_digest };
    }).filter(Boolean);
    recoveryFile = path.join(plan.root, ".hames/state/legacy-recovery.json");
    const recovery = { version: 1, project_root: plan.root, plan_hash: plan.plan_hash, removals: removalPlan, removed_count: 0 };
    writeRecovery(recoveryFile, recovery);
    for (const item of removalPlan) {
      recovery.removed_count = removed.length + 1;
      writeRecovery(recoveryFile, recovery);
      const target = safeResolved(plan.root, item.path);
      const current = item.kind === "symlink" ? fs.readlinkSync(target) : fs.readFileSync(target);
      if (digest(current) !== item.current_digest) throw new Error(`Legacy file changed immediately before cleanup: ${item.path}`);
      removed.push(item);
      fs.rmSync(target);
      if (failAfter && removed.length === failAfter) throw new Error("Simulated legacy failure");
    }
    const runtimeParent = path.resolve(__dirname, "..");
    const pluginRoot = fs.existsSync(path.join(runtimeParent, ".codex-plugin")) || fs.existsSync(path.join(runtimeParent, ".claude-plugin")) ? runtimeParent : path.resolve(runtimeParent, "..");
    fs.rmSync(recoveryFile, { force: true });
    const verification = require("./doctor.js").diagnose(plan.root, { pluginRoot });
    if (!verification.ok) throw new Error(`Legacy transition verification failed: ${verification.checks.filter((item) => item.status === "fail").map((item) => item.id).join(", ")}`);
    return { applied: true, removed: removed.map((item) => item.path), preserved: plan.preserved, workspaces: plan.workspace_registrations, verification };
  } catch (error) {
    for (const item of [...removed].reverse()) {
      const target = path.join(plan.root, item.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (item.kind === "symlink") fs.symlinkSync(item.content, target);
      else fs.writeFileSync(target, Buffer.from(item.content, "base64"), { mode: item.mode });
    }
    if (recoveryFile) fs.rmSync(recoveryFile, { force: true });
    if (setupApplied) restoreSetupPlan(plan.setup_plan);
    throw error;
  }
}

function generateManifests(repoRoot, manifestRoot = DEFAULT_MANIFEST_ROOT) {
  fs.mkdirSync(manifestRoot, { recursive: true });
  const names = [];
  for (const [index, commit] of SUPPORTED_COMMITS.entries()) {
    const tree = spawnSync("git", ["-C", repoRoot, "ls-tree", "-r", "-z", commit]).stdout;
    const records = tree.toString("utf8").split("\0").filter(Boolean);
    const files = records.map((record) => {
      const match = record.match(/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/);
      const [, mode, type, object, relative] = match;
      const protectedFile = isProtectedPath(relative);
      if (type === "commit") return { path: relative, kind: "submodule", revision: object, protected: false };
      if (protectedFile) return { path: relative, kind: mode === "120000" ? "symlink" : "file", protected: true };
      const content = spawnSync("git", ["-C", repoRoot, "show", `${commit}:${relative}`]).stdout;
      return { path: relative, kind: mode === "120000" ? "symlink" : "file", sha256: digest(content), protected: protectedFile };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const signaturePaths = ["CLAUDE.md", "AGENTS.md", ".cursor/rules/harness_engineering.md", "arsenal/CLAUDE.md", "README.md"].filter((relative) => files.some((item) => item.path === relative && item.kind === "file"));
    const manifest = {
      version: 1,
      id: `public-main-${String(index + 1).padStart(2, "0")}`,
      source: "https://github.com/baek-labs/hames",
      branch: "main",
      commits: [commit],
      files,
      signatures: signaturePaths.map((relative) => ({ path: relative, sha256: files.find((item) => item.path === relative).sha256, ...(relative === "CLAUDE.md" ? { kernel_marker: "HAMES SYSTEM KERNEL" } : {}) })),
    };
    manifest.manifest_digest = manifestDigest(manifest);
    const name = `${manifest.id}.json`;
    fs.writeFileSync(path.join(manifestRoot, name), `${JSON.stringify(manifest, null, 2)}\n`);
    names.push(name);
  }
  fs.writeFileSync(path.join(manifestRoot, "registry.json"), `${JSON.stringify({ version: 1, first_commit: SUPPORTED_COMMITS[0], last_commit: SUPPORTED_COMMITS.at(-1), manifests: names }, null, 2)}\n`);
  return names;
}

module.exports = { DEFAULT_MANIFEST_ROOT, SUPPORTED_COMMITS, applyLegacyTransition, detectLegacy, generateManifests, isProtectedPath, loadManifests, planLegacyTransition };
