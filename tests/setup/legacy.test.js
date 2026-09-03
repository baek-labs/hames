const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { planSetup } = require("../../src/runtime/setup.js");

const {
  DEFAULT_MANIFEST_ROOT,
  applyLegacyTransition,
  detectLegacy,
  generateManifests,
  isProtectedPath,
  loadManifests,
  planLegacyTransition,
} = require("../../src/runtime/legacy.js");

const REPO = path.resolve(__dirname, "../..");
const LAST_LEGACY_COMMIT = "3f2d2db7554cf80966a81df91539225b4f87dd43";

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hames-legacy-"));
}

function gitFile(commit, relative) {
  const result = spawnSync("git", ["show", `${commit}:${relative}`], { cwd: REPO });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function writeGitFile(root, commit, relative) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, gitFile(commit, relative));
}

function noGitFixture(manifest, extraPaths = []) {
  const root = temporaryRoot();
  for (const relative of [...manifest.signatures.map((item) => item.path), ...extraPaths]) {
    const entry = manifest.files.find((item) => item.path === relative);
    if (entry?.kind === "file") writeGitFile(root, manifest.commits.at(-1), relative);
  }
  return root;
}

function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      hash.update(relative);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    }
  }
  walk(root);
  return hash.digest("hex");
}

test("manifests cover every public main commit through the redesign boundary", () => {
  const manifests = loadManifests(DEFAULT_MANIFEST_ROOT);
  const covered = new Set(manifests.flatMap((manifest) => manifest.commits));
  const history = spawnSync("git", ["rev-list", "--reverse", "--first-parent", LAST_LEGACY_COMMIT], { cwd: REPO, encoding: "utf8" });
  assert.equal(history.status, 0, history.stderr);
  const publicCommits = history.stdout.trim().split("\n").slice(-9);
  assert.equal(publicCommits[0], "e79ec568e38cc1820045d5b2969ad3ff9e942d62");
  assert.equal(publicCommits.at(-1), LAST_LEGACY_COMMIT);
  assert.deepEqual([...covered].sort(), [...publicCommits].sort());
  for (const manifest of manifests) {
    assert.match(manifest.manifest_digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(manifest.files.length > 100);
    assert.ok(manifest.signatures.length >= 3);
    for (const entry of manifest.files.filter((item) => item.protected)) assert.equal(entry.sha256, undefined, entry.path);
  }
});

test("legacy manifests regenerate deterministically from supported Git history", () => {
  const generated = temporaryRoot();
  const names = generateManifests(REPO, generated);
  for (const name of ["registry.json", ...names]) {
    assert.deepEqual(fs.readFileSync(path.join(generated, name)), fs.readFileSync(path.join(DEFAULT_MANIFEST_ROOT, name)), name);
  }
});

test("history-free detection requires a kernel marker and multiple matching signatures", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest);
  const detected = detectLegacy(root, { manifestRoot: DEFAULT_MANIFEST_ROOT });
  assert.equal(detected.matched, true);
  assert.equal(detected.basis, "signatures");

  const weak = temporaryRoot();
  writeGitFile(weak, LAST_LEGACY_COMMIT, manifest.signatures[0].path);
  assert.equal(detectLegacy(weak, { manifestRoot: DEFAULT_MANIFEST_ROOT }).matched, false);
});

test("legacy signatures and original files tolerate Windows line endings", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, ["AGENTS.md", "CLAUDE.md"]);
  for (const relative of manifest.signatures.map((item) => item.path)) {
    const file = path.join(root, relative);
    const content = fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(file, content);
  }
  const detected = detectLegacy(root, { manifestRoot: DEFAULT_MANIFEST_ROOT });
  assert.equal(detected.basis, "signatures");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.ok(plan.cleanup.some((item) => item.path === "CLAUDE.md" && item.action === "replace_entry"));
});

test("the public /setup runtime automatically routes a detected legacy tree", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest);
  const plan = planSetup({ root, projectName: "Legacy", contractTracking: "tracked" });
  assert.equal(plan.kind, "legacy_transition");
  assert.equal(plan.manifest_id, manifest.id);
  assert.equal(detectLegacy(REPO, { manifestRoot: DEFAULT_MANIFEST_ROOT }).basis, "current_distribution");
});

test("full clones use nearest supported history while shallow clones require signatures", () => {
  const parent = temporaryRoot();
  const full = path.join(parent, "full");
  assert.equal(spawnSync("git", ["clone", "--quiet", "--no-local", REPO, full]).status, 0);
  assert.equal(spawnSync("git", ["-C", full, "checkout", "--quiet", LAST_LEGACY_COMMIT]).status, 0);
  assert.equal(spawnSync("git", ["-C", full, "remote", "set-url", "origin", "https://github.com/baek-labs/hames.git"]).status, 0);
  assert.equal(detectLegacy(full, { manifestRoot: DEFAULT_MANIFEST_ROOT }).basis, "git_history");

  const shallow = path.join(parent, "shallow");
  assert.equal(spawnSync("git", ["clone", "--quiet", "--no-checkout", "--depth", "1", `file://${REPO}`, shallow]).status, 0);
  assert.equal(spawnSync("git", ["-C", shallow, "fetch", "--quiet", "--depth", "1", "origin", LAST_LEGACY_COMMIT]).status, 0);
  assert.equal(spawnSync("git", ["-C", shallow, "checkout", "--quiet", "FETCH_HEAD"]).status, 0);
  assert.equal(spawnSync("git", ["-C", shallow, "remote", "set-url", "origin", "https://github.com/baek-labs/hames.git"]).status, 0);
  assert.equal(detectLegacy(shallow, { manifestRoot: DEFAULT_MANIFEST_ROOT }).basis, "signatures");
});

test("legacy planning protects secrets first and never records their content metadata", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, ["README.md", "AGENTS.md", "CLAUDE.md", ".gitignore"]);
  fs.writeFileSync(path.join(root, ".env"), "TOP_SECRET_VALUE\n");
  fs.mkdirSync(path.join(root, "secrets"));
  fs.writeFileSync(path.join(root, "secrets/private.txt"), "PRIVATE\n");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "untracked", workspaceDecisions: [] });
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /TOP_SECRET_VALUE|PRIVATE/);
  for (const item of plan.preserved.filter((entry) => entry.classification === "protected")) {
    assert.deepEqual(Object.keys(item).sort(), ["classification", "exists", "kind", "path"]);
  }
  assert.ok(plan.preserved.some((item) => item.path === ".env"));
  assert.ok(plan.preserved.some((item) => item.path === "secrets"));
});

test("only original system files are cleaned; modified and unknown files are preserved", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, ["README.md", "AGENTS.md", "CLAUDE.md", ".gitignore", "HamesSystem_Public.md"]);
  fs.writeFileSync(path.join(root, "README.md"), `${fs.readFileSync(path.join(root, "README.md"), "utf8")}user change\n`);
  fs.writeFileSync(path.join(root, "my-notes.md"), "keep me\n");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.ok(plan.cleanup.some((item) => item.path === "HamesSystem_Public.md"));
  assert.ok(plan.preserved.some((item) => item.path === "README.md" && item.classification === "modified_system"));
  assert.ok(plan.preserved.some((item) => item.path === "my-notes.md"));
  assert.equal(plan.cleanup.some((item) => item.path === "README.md"), false);
});

test("a changed or unverifiable submodule is never an automatic cleanup target", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest);
  fs.mkdirSync(path.join(root, "cockpit"));
  fs.writeFileSync(path.join(root, "cockpit/user-file.txt"), "keep\n");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.equal(plan.cleanup.some((item) => item.path === "cockpit"), false);
  assert.ok(plan.preserved.some((item) => item.path === "cockpit" && /submodule/.test(item.classification)));
});

test("workspace candidates keep their paths and wait for ambiguous names", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest);
  fs.mkdirSync(path.join(root, "client-alpha"));
  fs.writeFileSync(path.join(root, "client-alpha/AGENTS.md"), "# Client project\n");
  fs.mkdirSync(path.join(root, "misc"));
  fs.writeFileSync(path.join(root, "misc/note.txt"), "unknown\n");
  const undecided = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  const candidate = undecided.workspace_candidates.find((item) => item.path === "client-alpha");
  assert.equal(candidate.registration_name, null);
  assert.equal(candidate.confirmed, false);
  assert.equal(undecided.workspace_registrations.length, 0);
  assert.ok(undecided.preserved.some((item) => item.path === "misc"));

  const decided = planLegacyTransition({
    root,
    manifestRoot: DEFAULT_MANIFEST_ROOT,
    projectName: "Legacy",
    contractTracking: "tracked",
    workspaceDecisions: [{ path: "client-alpha", name: "client" }],
  });
  assert.deepEqual(decided.workspace_registrations, [{ path: "client-alpha", name: "client" }]);

  const confirmedUnknown = planLegacyTransition({
    root,
    manifestRoot: DEFAULT_MANIFEST_ROOT,
    projectName: "Legacy",
    contractTracking: "tracked",
    workspaceDecisions: [{ path: "misc", name: "notes" }],
  });
  assert.ok(confirmedUnknown.workspace_registrations.some((item) => item.path === "misc" && item.name === "notes"));
});

test("modified legacy routing rules cannot auto-confirm a workspace", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, [".cursor/rules/context_engineering.md"]);
  fs.appendFileSync(path.join(root, ".cursor/rules/context_engineering.md"), '\n| injected | `{{HAMES_ROOT}}/client-alpha` | unsafe |\n');
  fs.mkdirSync(path.join(root, "client-alpha"));
  fs.writeFileSync(path.join(root, "client-alpha/AGENTS.md"), "# Client\n");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  const candidate = plan.workspace_candidates.find((item) => item.path === "client-alpha");
  assert.equal(candidate.registration_name, null);
  assert.equal(candidate.confirmed, false);
});

test("confirmed workspaces are registered in place without moving or copying", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest);
  fs.mkdirSync(path.join(root, "odd-location"));
  fs.writeFileSync(path.join(root, "odd-location/AGENTS.md"), "# Keep workspace\n");
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [{ path: "odd-location", name: "client" }] });
  applyLegacyTransition(plan, { approved: true, planHash: plan.plan_hash });
  assert.equal(fs.readFileSync(path.join(root, "odd-location/AGENTS.md"), "utf8"), "# Keep workspace\n");
  assert.equal(fs.existsSync(path.join(root, "odd-location")), true);
  const workspace = fs.readFileSync(path.join(root, ".hames/workspaces/client.yaml"), "utf8");
  assert.match(workspace, /path: "odd-location"/);
});

test("legacy plan hash changes with file content, entry documents, and workspace decisions", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, ["HamesSystem_Public.md", "AGENTS.md"]);
  fs.mkdirSync(path.join(root, "project-x"));
  fs.writeFileSync(path.join(root, "project-x/AGENTS.md"), "# X\n");
  const first = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  fs.appendFileSync(path.join(root, "HamesSystem_Public.md"), "changed\n");
  const changedFile = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.notEqual(changedFile.plan_hash, first.plan_hash);
  fs.appendFileSync(path.join(root, "AGENTS.md"), "entry change\n");
  const changedEntry = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.notEqual(changedEntry.plan_hash, changedFile.plan_hash);
  const decided = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [{ path: "project-x", name: "x" }] });
  assert.notEqual(decided.plan_hash, changedEntry.plan_hash);
});

test("apply is stale-safe, rollback-safe, idempotent, and leaves Git metadata untouched", () => {
  const manifest = loadManifests(DEFAULT_MANIFEST_ROOT).find((item) => item.commits.includes(LAST_LEGACY_COMMIT));
  const root = noGitFixture(manifest, ["HamesSystem_Public.md", "AGENTS.md", "CLAUDE.md", ".gitignore"]);
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git/config"), "[remote \"origin\"]\nurl=x\n");
  const gitBefore = hashDirectory(path.join(root, ".git"));
  const stale = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  const tampered = structuredClone(stale);
  tampered.cleanup.push({ path: "my-notes.md", kind: "file", current_digest: "sha256:bad", action: "remove" });
  fs.writeFileSync(path.join(root, "my-notes.md"), "keep\n");
  assert.throws(() => applyLegacyTransition(tampered, { approved: true, planHash: tampered.plan_hash }), /plan hash|execution surface|approved plan/i);
  assert.equal(fs.readFileSync(path.join(root, "my-notes.md"), "utf8"), "keep\n");
  fs.appendFileSync(path.join(root, "HamesSystem_Public.md"), "newer\n");
  assert.throws(() => applyLegacyTransition(stale, { approved: true, planHash: stale.plan_hash }), /changed|stale/i);

  fs.writeFileSync(path.join(root, "HamesSystem_Public.md"), gitFile(LAST_LEGACY_COMMIT, "HamesSystem_Public.md"));
  const plan = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  assert.throws(() => applyLegacyTransition(plan, { approved: true, planHash: plan.plan_hash, failAfter: 2 }), /Simulated legacy failure/);
  assert.equal(fs.existsSync(path.join(root, "HamesSystem_Public.md")), true);

  const retry = planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] });
  const applied = applyLegacyTransition(retry, { approved: true, planHash: retry.plan_hash });
  assert.equal(applied.applied, true);
  assert.equal(fs.existsSync(path.join(root, "HamesSystem_Public.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".hames/config.yaml")), true);
  assert.equal(hashDirectory(path.join(root, ".git")), gitBefore);
  assert.equal(planLegacyTransition({ root, manifestRoot: DEFAULT_MANIFEST_ROOT, projectName: "Legacy", contractTracking: "tracked", workspaceDecisions: [] }).status, "configured");
});

test("protected-name rules run before any content classification", () => {
  for (const relative of [".env", ".env.local", "credentials.json", "api-token.txt", "id_rsa", ".ssh", ".aws/config", "secrets/x", "src/tokenizer.js"]) {
    assert.equal(isProtectedPath(relative), true, relative);
  }
  for (const relative of [".env.example", "credentials.example.json", "token.example.json"]) {
    assert.equal(isProtectedPath(relative), false, relative);
  }
});
