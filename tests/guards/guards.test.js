const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { applySetup, planSetup } = require("../../src/runtime/setup.js");
const { activateContract, approveContract, confirmCriticalAction, createDraft } = require("../../src/runtime/contract.js");
const { diagnose } = require("../../src/runtime/doctor.js");
const { captureHookEvidence } = require("../../src/hooks/evidence-guard.js");
const { guardToolUse, resolveInsideRoot } = require("../../src/hooks/scope-guard.js");

const PLUGIN_ROOT = path.resolve(__dirname, "../..");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-guard-"));
  applySetup(planSetup({ root, projectName: "Guard test", contractTracking: "untracked" }), { approved: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/allowed.js"), "module.exports = true;\n");
  return root;
}

function spec(taskId = "guard-test") {
  return {
    task_id: taskId,
    project: { id: "guard", root: ".", config_digest: `sha256:${"0".repeat(64)}` },
    goal: "Edit one file",
    targets: [{ id: "file", type: "file", locator: "src/allowed.js" }],
    actions: [{ id: "edit", target: "file", kind: "update", mutation_mode: "patch", risk: "normal", required_evidence: ["diff"] }],
    scope: { allow: ["src/allowed.js"], deny: ["src/denied.js"] },
    outputs: ["src/allowed.js"],
    invariants: ["Stay in project"],
    acceptance_criteria: [{ id: "changed", description: "File changed", evidence_ids: ["diff"] }],
    required_evidence: [{ id: "diff", type: "file_diff", action_id: "edit", predicate: { changed: true } }],
    risk: { level: "normal", critical_actions: [] },
  };
}

function activate(root, taskSpec = spec(), sessionId = "session") {
  createDraft(root, taskSpec, { sessionId: "ready" });
  approveContract(root, taskSpec.task_id, { approved: true });
  activateContract(root, taskSpec.task_id, { explicitGo: true, sessionId });
}

test("scope guard permits declared files and blocks traversal, denied paths, and symlink escape", () => {
  const root = project();
  activate(root);
  assert.equal(guardToolUse({ cwd: root, session_id: "session", tool_name: "Edit", tool_input: { file_path: "src/allowed.js" } }).allowed, true);
  assert.match(guardToolUse({ cwd: root, session_id: "session", tool_name: "Write", tool_input: { file_path: "src/denied.js" } }).reason, /denied|scope/i);
  assert.equal(guardToolUse({ cwd: root, session_id: "session", tool_name: "Read", tool_input: { file_path: "../outside" } }).allowed, false);
  assert.throws(() => resolveInsideRoot(root, "../outside.txt"), /outside|traversal/i);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hames-outside-"));
  fs.symlinkSync(outside, path.join(root, "src/link"));
  assert.match(guardToolUse({ cwd: root, session_id: "session", tool_name: "Write", tool_input: { file_path: "src/link/escape.txt" } }).reason, /outside|symlink/i);
});

test("scope guard blocks a tampered contract and best-effort shell escape", () => {
  const root = project();
  activate(root);
  const contractFile = path.join(root, ".hames/contracts/active/guard-test/contract.json");
  const contract = JSON.parse(fs.readFileSync(contractFile));
  contract.scope.allow.push("other/**");
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  assert.match(guardToolUse({ cwd: root, session_id: "session", tool_name: "Write", tool_input: { file_path: "src/allowed.js" } }).reason, /hash|integrity/i);

  fs.rmSync(path.join(root, ".hames/contracts/active/guard-test"), { recursive: true });
  fs.rmSync(path.join(root, ".hames/state/sessions"), { recursive: true });
  activate(root);
  assert.match(guardToolUse({ cwd: root, session_id: "session", tool_name: "Bash", tool_input: { command: "rm ../outside.txt" } }).reason, /outside|traversal/i);
});

test("structured critical actions are blocked until separately confirmed", () => {
  const root = project();
  const remote = spec("remote-create");
  remote.targets = [{ id: "service", type: "external_service", provider: "mock", resource_kind: "record", parent: "workspace", planned_name: "record" }];
  remote.actions = [{ id: "create", target: "service", kind: "create", risk: "critical", required_evidence: ["before", "action", "after"] }];
  remote.required_evidence = ["before", "action", "after"].map((phase) => ({ id: phase, type: "api_state", action_id: "create", phase, predicate: { status_codes: [200] } }));
  remote.acceptance_criteria = [{ id: "created", description: "Created", evidence_ids: ["after"] }];
  remote.risk = { level: "critical", critical_actions: ["create"] };
  activate(root, remote);
  const before = { cwd: root, session_id: "session", tool_use_id: "before", tool_name: "mcp__mock__get_workspace", tool_input: { workspace_id: "workspace" }, tool_response: { status_code: 200, resource_id: "workspace", data: {} } };
  assert.equal(guardToolUse(before).allowed, true);
  assert.equal(captureHookEvidence(before).recorded, true);
  const event = { cwd: root, session_id: "session", tool_use_id: "create", tool_name: "mcp__mock__create", tool_input: { hames_target_id: "service", hames_action_id: "create", parent: "workspace", name: "record", resource_kind: "record" } };
  assert.match(guardToolUse(event).reason, /confirmation/i);
  confirmCriticalAction(root, "remote-create", "session", "create", { confirmed: true, expectedImpact: "Creates one record" });
  assert.equal(guardToolUse(event).allowed, true);
  assert.match(guardToolUse(event).reason, /confirmation/i);
});

test("structured external tools must match provider and stable resource locator", () => {
  const root = project();
  const remote = spec("remote-update");
  remote.targets = [{ id: "service", type: "external_service", provider: "mock", resource_kind: "record", locator: "record-1" }];
  remote.actions = [{ id: "update", target: "service", kind: "update", risk: "critical", required_evidence: ["before", "action", "after"] }];
  remote.required_evidence = ["before", "action", "after"].map((phase) => ({ id: phase, type: "api_state", action_id: "update", phase, predicate: { status_codes: [200] } }));
  remote.acceptance_criteria = [{ id: "updated", description: "Updated", evidence_ids: ["after"] }];
  remote.risk = { level: "critical", critical_actions: ["update"] };
  activate(root, remote);
  const before = { cwd: root, session_id: "session", tool_use_id: "update-before", tool_name: "mcp__mock__get_record", tool_input: { record_id: "record-1" }, tool_response: { status_code: 200, resource_id: "record-1", data: {} } };
  assert.equal(guardToolUse(before).allowed, true);
  assert.equal(captureHookEvidence(before).recorded, true);
  confirmCriticalAction(root, "remote-update", "session", "update", { confirmed: true, expectedImpact: "Updates one record" });
  const wrong = guardToolUse({ cwd: root, session_id: "session", tool_use_id: "wrong", tool_name: "mcp__mock__update", tool_input: { hames_target_id: "service", hames_action_id: "update", record_id: "record-2" } });
  assert.equal(wrong.allowed, false);
  assert.match(wrong.reason, /provider|resource|locator|no external/i);
  const right = guardToolUse({ cwd: root, session_id: "session", tool_use_id: "right", tool_name: "mcp__mock__update", tool_input: { hames_target_id: "service", hames_action_id: "update", resource_id: "record-1" } });
  assert.equal(right.allowed, true);
});

test("declared identifiers cannot bypass concrete path and action-kind checks", () => {
  const root = project();
  const readOnly = spec("read-only");
  readOnly.actions[0].kind = "read";
  activate(root, readOnly);
  const structuredEscape = guardToolUse({
    cwd: root,
    session_id: "session",
    tool_name: "Write",
    tool_input: { file_path: "../outside.txt", hames_target_id: "file", hames_action_id: "edit" },
  });
  assert.equal(structuredEscape.allowed, false);
  const wrongKind = guardToolUse({ cwd: root, session_id: "session", tool_name: "Write", tool_input: { file_path: "src/allowed.js" } });
  assert.equal(wrongKind.allowed, false);
  assert.match(wrongKind.reason, /action|kind/i);
  assert.equal(guardToolUse({ cwd: root, session_id: "session", tool_name: "Read", tool_input: { file_path: "src/allowed.js" } }).allowed, true);
  assert.equal(guardToolUse({ cwd: root, session_id: "session", tool_name: "Bash", tool_input: { command: "cat ../outside.txt" } }).allowed, false);
});

test("scope and evidence hooks reject a session pointer redirected outside its contract", () => {
  const root = project();
  activate(root);
  const sessions = path.join(root, ".hames/state/sessions");
  const pointerFile = path.join(sessions, fs.readdirSync(sessions)[0]);
  const pointer = JSON.parse(fs.readFileSync(pointerFile));
  pointer.contract_path = "../../outside";
  fs.writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
  const event = { cwd: root, session_id: "session", tool_name: "Write", tool_input: { file_path: "src/allowed.js", hames_evidence_id: "diff" } };
  assert.match(guardToolUse(event).reason, /pointer.*path|mismatch/i);
  assert.equal(captureHookEvidence(event).recorded, false);
});

test("evidence hook records only contract-bound safe metadata", () => {
  const root = project();
  activate(root);
  const result = captureHookEvidence({
    cwd: root,
    session_id: "session",
    tool_name: "Write",
    tool_input: {
      file_path: "src/allowed.js",
      hames_evidence_id: "diff",
      hames_action_id: "edit",
      hames_target_id: "file",
      hames_before_digest: "sha256:forged-before",
      hames_after_digest: "sha256:forged-after",
      hames_summary: "Forged summary",
      secret: "DO_NOT_STORE",
    },
    tool_use_id: "tool-diff",
    tool_response: { before_digest: "sha256:observed-before", after_digest: "sha256:observed-after", summary: "Changed one export", raw_output: "DO_NOT_STORE" },
  });
  assert.equal(result.recorded, true);
  const stored = fs.readFileSync(path.join(root, ".hames/contracts/active/guard-test/evidence.json"), "utf8");
  assert.doesNotMatch(stored, /DO_NOT_STORE/);
  assert.match(stored, /sha256:observed-before/);
  assert.doesNotMatch(stored, /forged-before|Forged summary/);
});

test("doctor is read-only and reports valid, damaged, and interrupted states", () => {
  const root = project();
  const before = fs.readdirSync(root, { recursive: true }).sort();
  const healthy = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.equal(healthy.ok, true);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);

  fs.writeFileSync(path.join(root, ".hames/config.yaml"), "broken: [\n");
  const damaged = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.equal(damaged.ok, false);
  assert.ok(damaged.checks.some((item) => item.id === "config" && item.status === "fail"));

  fs.writeFileSync(path.join(root, ".hames/state/setup-recovery.json"), "{}\n");
  const interrupted = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.ok(interrupted.recovery.some((item) => /setup/i.test(item)));
});

test("doctor detects evidence and session linkage drift", () => {
  const root = project();
  activate(root);
  const evidenceFile = path.join(root, ".hames/contracts/active/guard-test/evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile));
  evidence.spec_hash = "sha256:bad";
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const pointerFile = path.join(root, ".hames/state/sessions", fs.readdirSync(path.join(root, ".hames/state/sessions"))[0]);
  const pointer = JSON.parse(fs.readFileSync(pointerFile));
  pointer.revision = 99;
  fs.writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
  const report = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((item) => item.id === "evidence:active:guard-test" && item.status === "fail"));
  assert.ok(report.checks.some((item) => item.id.startsWith("session:") && item.status === "fail"));
});

test("doctor returns a structured failure for parseable but invalid config", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".hames/config.yaml"), "version: 1\n");
  const report = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((item) => item.id === "config" && item.status === "fail"));
  assert.ok(report.checks.some((item) => item.id === "contract-tracking" && item.status === "warn"));
});

test("doctor validates workspace paths, schemas, and hook wiring rather than file presence", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".hames/workspaces/default.yaml"), 'version: 1\nid: "default"\npath: "../outside"\ncontext: []\nprotect: []\n');
  assert.ok(diagnose(root, { pluginRoot: PLUGIN_ROOT }).checks.some((item) => item.id === "workspace:default" && item.status === "fail"));

  fs.writeFileSync(path.join(root, ".hames/workspaces/default.yaml"), 'version: 1\nid: "default"\npath: "."\ncontext: [".hames/context/project.md"]\nprotect: [".hames/config.yaml"]\n');
  const plugin = fs.mkdtempSync(path.join(os.tmpdir(), "hames-plugin-check-"));
  for (const relative of ["src/skills", "src/hooks", "src/schemas", "platform"]) {
    fs.cpSync(path.join(PLUGIN_ROOT, relative), path.join(plugin, relative), { recursive: true });
  }
  fs.writeFileSync(path.join(plugin, "src/hooks/hooks.json"), "{}\n");
  fs.writeFileSync(path.join(plugin, "platform/codex/plugin.json"), "not-json\n");
  const report = diagnose(root, { pluginRoot: plugin });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((item) => item.id === "hook:hooks.json" && item.status === "fail"));
  assert.ok(report.checks.some((item) => item.id === "plugin-manifest" && item.status === "fail"));
  assert.ok(report.checks.some((item) => item.id === "schema:config.schema.json" && item.status === "pass"));
});

test("doctor applies config schema rules for unknown keys and duplicate features", () => {
  const root = project();
  const file = path.join(root, ".hames/config.yaml");
  const source = fs.readFileSync(file, "utf8").replace('features: ["setup", "ready", "go", "doctor"]', 'features: ["setup", "ready", "go", "doctor", "doctor"]') + "unknown_key: true\n";
  fs.writeFileSync(file, source);
  const report = diagnose(root, { pluginRoot: PLUGIN_ROOT });
  assert.equal(report.ok, false);
  const detail = report.checks.find((item) => item.id === "config").detail;
  assert.match(detail, /duplicate|not allowed/i);
});
