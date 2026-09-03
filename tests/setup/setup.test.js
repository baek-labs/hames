const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { parseConfig, validateConfig } = require("../../src/runtime/config.js");
const { applySetup, planSetup, previewSetupRecovery, recoverSetup } = require("../../src/runtime/setup.js");

function project({ git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-setup-"));
  if (git) fs.mkdirSync(path.join(root, ".git"));
  return root;
}

test("setup previews a new Git project and writes only after approval", () => {
  const root = project();
  const plan = planSetup({ root, projectName: "Example", contractTracking: "tracked" });
  assert.equal(plan.status, "ready");
  assert.equal(plan.git, true);
  assert.ok(plan.operations.some((item) => item.path === ".hames/config.yaml"));
  assert.ok(plan.operations.some((item) => item.path === "AGENTS.md"));
  assert.ok(plan.operations.some((item) => item.path === "CLAUDE.md"));
  assert.ok(plan.operations.some((item) => item.path === ".gitignore"));
  assert.equal(fs.existsSync(path.join(root, ".hames")), false);

  const refused = applySetup(plan, { approved: false });
  assert.equal(refused.applied, false);
  assert.equal(fs.existsSync(path.join(root, ".hames")), false);

  const result = applySetup(plan, { approved: true });
  assert.equal(result.applied, true);
  const config = parseConfig(fs.readFileSync(path.join(root, ".hames/config.yaml"), "utf8"));
  assert.equal(validateConfig(config).valid, true);
  assert.deepEqual(config.extensions, {});
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/active")), true);
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/archive")), true);
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /\.hames\/state\//);
});

test("setup preserves existing entry documents and is idempotent", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Existing agents\n\nKeep this.\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Existing Claude rules\n");
  const first = planSetup({ root, projectName: "Existing", contractTracking: "untracked" });
  applySetup(first, { approved: true });

  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(agents, /^# Existing agents\n\nKeep this\./);
  assert.match(claude, /^# Existing Claude rules/);
  assert.equal((agents.match(/<!-- HAMES:START -->/g) || []).length, 1);
  assert.equal((claude.match(/<!-- HAMES:START -->/g) || []).length, 1);
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /\.hames\/contracts\//);

  const before = new Map(["AGENTS.md", "CLAUDE.md", ".gitignore", ".hames/config.yaml"].map(
    (name) => [name, fs.readFileSync(path.join(root, name), "utf8")],
  ));
  const second = planSetup({ root, projectName: "Existing", contractTracking: "untracked" });
  assert.equal(second.status, "configured");
  assert.equal(second.operations.length, 0);
  const diagnosed = applySetup(second, { approved: true });
  assert.equal(diagnosed.applied, false);
  for (const [name, content] of before) {
    assert.equal(fs.readFileSync(path.join(root, name), "utf8"), content);
  }
});

test("setup supports non-Git projects without creating .gitignore", () => {
  const root = project({ git: false });
  const plan = planSetup({ root, projectName: "Notes", contractTracking: "untracked" });
  assert.equal(plan.git, false);
  assert.equal(plan.operations.some((item) => item.path === ".gitignore"), false);
  applySetup(plan, { approved: true });
  assert.equal(fs.existsSync(path.join(root, ".gitignore")), false);
});

test("setup asks for contract tracking and does not guess", () => {
  const root = project();
  const plan = planSetup({ root, projectName: "Choice" });
  assert.equal(plan.status, "needs_input");
  assert.deepEqual(plan.questions.map((item) => item.id), ["contract_tracking"]);
  assert.equal(plan.operations.length, 0);
});

test("setup reports damaged config without overwriting it", () => {
  const root = project();
  fs.mkdirSync(path.join(root, ".hames"));
  fs.writeFileSync(path.join(root, ".hames/config.yaml"), "version: [broken\n");
  const plan = planSetup({ root, projectName: "Broken", contractTracking: "tracked" });
  assert.equal(plan.status, "invalid_config");
  assert.equal(plan.operations.length, 0);
  assert.match(plan.errors[0], /config\.yaml/);
  assert.equal(fs.readFileSync(path.join(root, ".hames/config.yaml"), "utf8"), "version: [broken\n");
});

test("a failed apply rolls back file changes and leaves no success marker", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Keep me\n");
  const plan = planSetup({ root, projectName: "Rollback", contractTracking: "tracked" });
  assert.throws(
    () => applySetup(plan, { approved: true, failAfter: 3 }),
    /Simulated setup failure/,
  );
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# Keep me\n");
  assert.equal(fs.existsSync(path.join(root, ".hames/state/setup-complete.json")), false);

  const retry = planSetup({ root, projectName: "Rollback", contractTracking: "tracked" });
  assert.equal(retry.status, "ready");
});

test("setup preserves project-owned context and updates only managed boundary blocks", () => {
  const root = project();
  applySetup(planSetup({ root, projectName: "Managed", contractTracking: "tracked" }), { approved: true });
  fs.writeFileSync(path.join(root, ".hames/context/project.md"), "# Durable user decision\n");
  const agentsFile = path.join(root, "AGENTS.md");
  const agents = fs.readFileSync(agentsFile, "utf8");
  fs.writeFileSync(agentsFile, `User preface\n\n${agents.replace("use `/ready`", "use old instructions")}\nUser suffix\n`);
  fs.chmodSync(agentsFile, 0o640);

  const plan = planSetup({ root, projectName: "Managed", contractTracking: "tracked" });
  assert.equal(plan.operations.some((item) => item.path === ".hames/context/project.md"), false);
  const entry = plan.operations.find((item) => item.path === "AGENTS.md");
  assert.equal(entry.type, "update");
  assert.match(entry.after, /^User preface/);
  assert.match(entry.after, /User suffix/);
  assert.doesNotMatch(entry.after, /old instructions/);
  applySetup(plan, { approved: true });
  assert.equal(fs.readFileSync(path.join(root, ".hames/context/project.md"), "utf8"), "# Durable user decision\n");
  if (process.platform !== "win32") assert.equal(fs.statSync(agentsFile).mode & 0o777, 0o640);
});

test("interrupted setup recovery rolls back only journaled operations", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Before\n");
  const plan = planSetup({ root, projectName: "Recovery", contractTracking: "tracked" });
  const agentIndex = plan.operations.findIndex((item) => item.path === "AGENTS.md");
  fs.writeFileSync(path.join(root, "AGENTS.md"), plan.operations[agentIndex].after);
  fs.mkdirSync(path.join(root, ".hames/state"), { recursive: true });
  fs.writeFileSync(path.join(root, ".hames/state/setup-recovery.json"), `${JSON.stringify({
    version: 1,
    project_root: root,
    plan_hash: plan.plan_hash,
    plan,
    completed_count: agentIndex + 1,
  }, null, 2)}\n`);
  const preview = previewSetupRecovery(root);
  assert.equal(recoverSetup(root).reason, "approval_required");
  const result = recoverSetup(root, { approved: true, recoveryHash: preview.recovery_hash });
  assert.equal(result.recovered, true);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "Before\n");
  assert.equal(fs.existsSync(path.join(root, ".hames/state/setup-recovery.json")), false);
});

test("configuration cannot remove built-in critical actions", () => {
  const root = project();
  applySetup(planSetup({ root, projectName: "Critical", contractTracking: "tracked" }), { approved: true });
  const file = path.join(root, ".hames/config.yaml");
  const weakened = fs.readFileSync(file, "utf8").replace('"delete", ', "");
  const parsed = parseConfig(weakened);
  assert.equal(validateConfig(parsed).valid, false);
  assert.match(validateConfig(parsed).errors.join("; "), /cannot remove/);
});

test("setup refuses a plan changed after preview", () => {
  const root = project();
  const plan = planSetup({ root, projectName: "Tamper", contractTracking: "tracked" });
  plan.operations[0].path = "../outside";
  assert.throws(() => applySetup(plan, { approved: true }), /plan.*changed|hash/i);
});

test("configured projects reuse their tracking choice and preview explicit changes", () => {
  const root = project();
  applySetup(planSetup({ root, projectName: "Choice", contractTracking: "tracked" }), { approved: true });
  const repeated = planSetup({ root, projectName: "Choice" });
  assert.equal(repeated.status, "configured");
  assert.equal(repeated.contractTracking, "tracked");

  const changed = planSetup({ root, projectName: "Choice", contractTracking: "untracked" });
  assert.equal(changed.status, "ready");
  assert.ok(changed.operations.some((item) => item.path === ".hames/config.yaml"));
  assert.ok(changed.operations.some((item) => item.path === ".gitignore"));
  applySetup(changed, { approved: true });
  const config = parseConfig(fs.readFileSync(path.join(root, ".hames/config.yaml"), "utf8"));
  assert.equal(config.tracking.contracts, "untracked");
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /\.hames\/contracts\//);
});

test("setup CLI requires the exact preview hash before apply", () => {
  const root = project({ git: false });
  const runtime = path.resolve(__dirname, "../../src/runtime/setup.js");
  const base = [runtime, "apply", "--root", root, "--project-name", "CLI", "--contracts", "tracked", "--approved"];
  const missing = spawnSync(process.execPath, base, { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.equal(fs.existsSync(path.join(root, ".hames")), false);

  const preview = spawnSync(process.execPath, [runtime, "plan", "--root", root, "--project-name", "CLI", "--contracts", "tracked"], { encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
  const hash = JSON.parse(preview.stdout).plan_hash;
  const applied = spawnSync(process.execPath, [...base, "--plan-hash", hash], { encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).applied, true);
});

test("setup refuses stale previews instead of overwriting newer project edits", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Original\n");
  const plan = planSetup({ root, projectName: "Stale", contractTracking: "tracked" });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Newer user edit\n");
  assert.throws(() => applySetup(plan, { approved: true }), /project changed|stale/i);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "Newer user edit\n");
});

test("setup rejects a .hames symlink that leaves the project", () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hames-setup-outside-"));
  fs.symlinkSync(outside, path.join(root, ".hames"));
  assert.throws(() => planSetup({ root, projectName: "Escape", contractTracking: "tracked" }), /symlink|outside/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("setup rejects a nested managed-directory symlink that leaves the project", () => {
  const root = project();
  applySetup(planSetup({ root, projectName: "Nested", contractTracking: "tracked" }), { approved: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hames-setup-nested-"));
  fs.renameSync(path.join(root, ".hames/workspaces"), path.join(root, ".hames/workspaces-old"));
  fs.symlinkSync(outside, path.join(root, ".hames/workspaces"));
  assert.throws(() => planSetup({ root, projectName: "Nested" }), /symlink|outside/i);
});

test("recovery rejects injected paths and never changes an outside file", () => {
  const root = project();
  const outside = path.join(path.dirname(root), "victim.txt");
  fs.writeFileSync(outside, "Keep\n");
  fs.mkdirSync(path.join(root, ".hames/state"), { recursive: true });
  fs.writeFileSync(path.join(root, ".hames/state/setup-recovery.json"), `${JSON.stringify({
    version: 1,
    project_root: root,
    plan_hash: "sha256:fake",
    plan: { root, git: true, contractTracking: "tracked", operations: [{ type: "update", path: "../victim.txt", before: "Owned\n", after: "Keep\n" }] },
    completed_count: 1,
  }, null, 2)}\n`);
  const preview = previewSetupRecovery(root);
  assert.equal(preview.valid, false);
  assert.throws(() => recoverSetup(root, { approved: true, recoveryHash: preview.recovery_hash }), /invalid|outside|hash/i);
  assert.equal(fs.readFileSync(outside, "utf8"), "Keep\n");
});
