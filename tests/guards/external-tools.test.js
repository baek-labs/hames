const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { captureHookEvidence } = require("../../src/hooks/evidence-guard.js");
const { guardToolUse } = require("../../src/hooks/scope-guard.js");
const { applySetup, planSetup } = require("../../src/runtime/setup.js");
const { activateContract, approveContract, confirmCriticalAction, createDraft } = require("../../src/runtime/contract.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-external-"));
  applySetup(planSetup({ root, projectName: "External", contractTracking: "untracked" }), { approved: true });
  return root;
}

function remoteSpec(taskId = "remote-update") {
  return {
    task_id: taskId,
    project: { id: "external", root: ".", config_digest: `sha256:${"0".repeat(64)}` },
    goal: "Update one remote record",
    targets: [{ id: "record", type: "external_service", provider: "mock", resource_kind: "record", locator: "record-1" }],
    actions: [{ id: "update-record", target: "record", kind: "update", risk: "critical", required_evidence: ["before", "action", "after"] }],
    scope: { allow: [], deny: [] },
    outputs: ["record"],
    invariants: ["Only record-1 changes"],
    acceptance_criteria: [{ id: "updated", description: "Record is updated", evidence_ids: ["after"] }],
    required_evidence: [
      { id: "before", type: "api_state", action_id: "update-record", phase: "before", predicate: { status_codes: [200] } },
      { id: "action", type: "api_state", action_id: "update-record", phase: "action", predicate: { status_codes: [200] } },
      { id: "after", type: "api_state", action_id: "update-record", phase: "after", predicate: { status_codes: [200], field_equals: { state: "updated" } } },
    ],
    risk: { level: "critical", critical_actions: ["update-record"] },
  };
}

function activate(root, spec = remoteSpec()) {
  createDraft(root, spec, { sessionId: "ready" });
  approveContract(root, spec.task_id, { approved: true });
  activateContract(root, spec.task_id, { explicitGo: true, sessionId: "session" });
}

function event(root, toolUseId, toolName, toolInput, toolResponse) {
  return { cwd: root, session_id: "session", tool_use_id: toolUseId, tool_name: toolName, tool_input: toolInput, tool_response: toolResponse };
}

test("realistic external tool schemas work without hames metadata", () => {
  const root = project();
  activate(root);

  const before = event(root, "tool-before", "mcp__mock__get_record", { record_id: "record-1" }, { status_code: 200, resource_id: "record-1", data: { state: "old" } });
  assert.equal(guardToolUse(before).allowed, true);
  assert.equal(captureHookEvidence(before).recorded, true);

  confirmCriticalAction(root, "remote-update", "session", "update-record", { confirmed: true, expectedImpact: "Updates record-1" });
  const action = event(root, "tool-action", "mcp__mock__update_record", { record_id: "record-1", changes: { state: "updated" } }, { status_code: 200, resource_id: "record-1", data: { state: "updated" } });
  assert.equal(guardToolUse(action).allowed, true);
  assert.equal(captureHookEvidence(action).recorded, true);

  const after = event(root, "tool-after", "mcp__mock__get_record", { record_id: "record-1" }, { status_code: 200, resource_id: "record-1", data: { state: "updated" } });
  assert.equal(guardToolUse(after).allowed, true);
  assert.equal(captureHookEvidence(after).recorded, true);

  const stored = JSON.parse(fs.readFileSync(path.join(root, ".hames/contracts/active/remote-update/evidence.json"), "utf8"));
  assert.deepEqual(Object.keys(stored.items).sort(), ["action", "after", "before"]);
  assert.ok(Object.values(stored.items).every((item) => item.status === "passed"));
});

test("external auto-selection fails closed for wrong provider, resource, order, or ambiguity", () => {
  const root = project();
  activate(root);
  const earlyMutation = event(root, "early", "mcp__mock__update_record", { record_id: "record-1" }, { status_code: 200, resource_id: "record-1", data: {} });
  assert.equal(guardToolUse(earlyMutation).allowed, false);
  assert.equal(guardToolUse(event(root, "wrong-provider", "mcp__other__get_record", { record_id: "record-1" }, {})).allowed, false);
  assert.equal(guardToolUse(event(root, "wrong-resource", "mcp__mock__get_record", { record_id: "record-2" }, {})).allowed, false);

  const ambiguousRoot = project();
  const spec = remoteSpec("ambiguous");
  spec.actions.push({ id: "update-again", target: "record", kind: "update", risk: "critical", required_evidence: ["before-2", "action-2", "after-2"] });
  spec.required_evidence.push(
    { id: "before-2", type: "api_state", action_id: "update-again", phase: "before", predicate: { status_codes: [200] } },
    { id: "action-2", type: "api_state", action_id: "update-again", phase: "action", predicate: { status_codes: [200] } },
    { id: "after-2", type: "api_state", action_id: "update-again", phase: "after", predicate: { status_codes: [200] } },
  );
  spec.risk.critical_actions.push("update-again");
  activate(ambiguousRoot, spec);
  const ambiguous = guardToolUse(event(ambiguousRoot, "ambiguous-read", "mcp__mock__get_record", { record_id: "record-1" }, {}));
  assert.equal(ambiguous.allowed, false);
  assert.match(ambiguous.reason, /multiple|ambiguous/i);
});

test("create tools match planned parent, name, and type without extra schema fields", () => {
  const root = project();
  const spec = remoteSpec("remote-create");
  spec.targets = [{ id: "record", type: "external_service", provider: "mock", resource_kind: "record", parent: "list-1", planned_name: "New record" }];
  spec.actions = [{ id: "create-record", target: "record", kind: "create", risk: "critical", required_evidence: ["before", "action", "after"] }];
  spec.required_evidence = [
    { id: "before", type: "api_state", action_id: "create-record", phase: "before", predicate: { status_codes: [200] } },
    { id: "action", type: "api_state", action_id: "create-record", phase: "action", predicate: { status_codes: [201] } },
    { id: "after", type: "api_state", action_id: "create-record", phase: "after", predicate: { status_codes: [200] } },
  ];
  spec.risk.critical_actions = ["create-record"];
  activate(root, spec);
  const before = event(root, "create-before", "mcp__mock__get_list", { list_id: "list-1" }, { status_code: 200, resource_id: "list-1", data: {} });
  assert.equal(guardToolUse(before).allowed, true);
  assert.equal(captureHookEvidence(before).recorded, true);
  confirmCriticalAction(root, "remote-create", "session", "create-record", { confirmed: true, expectedImpact: "Creates New record in list-1" });
  const create = event(root, "create-action", "mcp__mock__create_record", { parent: "list-1", name: "New record", resource_kind: "record" }, { status_code: 201, resource_id: "record-new", data: { parent: "list-1", name: "New record", resource_kind: "record", duplicate: false } });
  assert.equal(guardToolUse(create).allowed, true);
  assert.equal(captureHookEvidence(create).recorded, true);
});
