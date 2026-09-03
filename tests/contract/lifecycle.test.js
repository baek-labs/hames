const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const { applySetup, planSetup } = require("../../src/runtime/setup.js");
const {
  acceptAndArchive,
  activateContract,
  amendContract,
  approveContract,
  confirmCriticalAction,
  computeSpecHash,
  createDraft,
  criticalActionConfirmed,
  moveToReview,
  recordEvidence,
  resolveGoCandidate,
  validateSpec,
} = require("../../src/runtime/contract.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-contract-"));
  applySetup(planSetup({ root, projectName: "Contract test", contractTracking: "untracked" }), { approved: true });
  return root;
}

function codeSpec(taskId = "change-code") {
  return {
    task_id: taskId,
    project: { id: "contract-test", root: ".", config_digest: `sha256:${"0".repeat(64)}` },
    goal: "Update one source file",
    targets: [{ id: "source", type: "file", locator: "src/example.js" }],
    actions: [{ id: "edit", target: "source", kind: "update", mutation_mode: "patch", risk: "normal", required_evidence: ["test"] }],
    scope: { allow: ["src/example.js"], deny: ["secrets/**"] },
    outputs: ["src/example.js"],
    invariants: ["Do not change public behavior outside the target"],
    acceptance_criteria: [{ id: "tests-pass", description: "Targeted test passes", evidence_ids: ["test"] }],
    required_evidence: [{ id: "test", type: "test", action_id: "edit", command: "node --test test/example.test.js", predicate: { exit_code: 0, output_includes: "tests passed" } }],
    risk: { level: "normal", critical_actions: [] },
  };
}

function passingTestEvidence() {
  return {
    id: "test",
    target_id: "source",
    action_id: "edit",
    observation: {
      source: "hook",
      tool_name: "Bash",
      tool_use_id: "tool-test",
      method: "node --test",
      tool_input: { command: "node --test test/example.test.js" },
      tool_response: { exit_code: 0, output: "tests passed" },
    },
  };
}

test("code contract moves through approval, activation, evidence, review, and archive", () => {
  const root = project();
  const draft = createDraft(root, codeSpec(), { sessionId: "ready-session" });
  assert.equal(draft.contract.status, "DRAFT");
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/active/change-code/contract.md")), true);
  approveContract(root, "change-code", { approved: true, approvedBy: "current-user" });
  const active = activateContract(root, "change-code", { explicitGo: true, sessionId: "go-session" });
  assert.equal(active.status, "ACTIVE");
  recordEvidence(root, "change-code", "go-session", passingTestEvidence());
  const review = moveToReview(root, "change-code", "go-session", {
    outputs: [{ requirement: "tests-pass", output: "src/example.js", artifact: "src/example.js" }],
    limitations: [],
  });
  assert.equal(review.status, "REVIEW");
  const archived = acceptAndArchive(root, "change-code", "go-session", { accepted: true, acceptedBy: "current-user" });
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/active/change-code")), false);
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/archive/change-code/result.md")), true);
});

test("new remote targets ask only for missing parent and planned name", () => {
  const root = project();
  const spec = codeSpec("create-doc");
  spec.targets = [{ id: "doc", type: "document", provider: "mock", resource_kind: "page" }];
  spec.actions = [{ id: "create", target: "doc", kind: "create", risk: "critical", required_evidence: ["before", "action", "after"] }];
  spec.required_evidence = [
    { id: "before", type: "api_state", action_id: "create", phase: "before", predicate: { status_codes: [200] } },
    { id: "action", type: "api_state", action_id: "create", phase: "action", predicate: { status_codes: [201] } },
    { id: "after", type: "api_state", action_id: "create", phase: "after", predicate: { status_codes: [200] } },
  ];
  spec.acceptance_criteria = [{ id: "created", description: "Document exists", evidence_ids: ["after"] }];
  spec.risk = { level: "critical", critical_actions: ["create"] };
  const missing = createDraft(root, spec, { sessionId: "ready" });
  assert.equal(missing.status, "needs_input");
  assert.deepEqual(missing.questions.map((item) => item.field).sort(), ["parent", "planned_name"]);
  assert.equal(fs.existsSync(path.join(root, ".hames/contracts/active/create-doc")), false);

  spec.targets[0].parent = "Projects database";
  spec.targets[0].planned_name = "Hames redesign";
  const created = createDraft(root, spec, { sessionId: "ready" });
  assert.equal(created.contract.targets[0].planned_name, "Hames redesign");
});

test("amending a contract invalidates approval, evidence, and session state", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true, approvedBy: "current-user" });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "go" });
  recordEvidence(root, "change-code", "go", passingTestEvidence());
  const amended = amendContract(root, "change-code", { goal: "Update exactly one source file" });
  assert.equal(amended.status, "AMENDMENT_PENDING");
  assert.equal(amended.revision, 2);
  assert.equal(amended.approval, null);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, ".hames/contracts/active/change-code/evidence.json")));
  assert.deepEqual(evidence.items, {});
  assert.equal(fs.readdirSync(path.join(root, ".hames/state/sessions")).length, 0);
});

test("activation rejects missing approval, missing go, tampering, and concurrent sessions", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  assert.throws(() => activateContract(root, "change-code", { explicitGo: true, sessionId: "one" }), /READY/);
  approveContract(root, "change-code", { approved: true, approvedBy: "current-user" });
  assert.throws(() => activateContract(root, "change-code", { explicitGo: false, sessionId: "one" }), /explicit \/go/i);

  const file = path.join(root, ".hames/contracts/active/change-code/contract.json");
  const tampered = JSON.parse(fs.readFileSync(file));
  tampered.goal = "Tampered goal";
  fs.writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => activateContract(root, "change-code", { explicitGo: true, sessionId: "one" }), /hash/i);

  fs.rmSync(path.join(root, ".hames/contracts/active/change-code"), { recursive: true });
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true, approvedBy: "current-user" });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "one" });
  assert.throws(() => activateContract(root, "change-code", { explicitGo: true, sessionId: "two" }), /another session/i);
});

test("review requires successful evidence and stores only safe metadata", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true, approvedBy: "current-user" });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "go" });
  assert.throws(() => moveToReview(root, "change-code", "go", { outputs: [], limitations: [] }), /Missing required evidence/);
  const wrongCommand = passingTestEvidence();
  wrongCommand.observation.tool_input.command = "echo tests passed";
  assert.equal(recordEvidence(root, "change-code", "go", wrongCommand).status, "failed");
  const evidence = passingTestEvidence();
  evidence.raw_output = "SECRET";
  evidence.api_key = "SECRET";
  evidence.observation.tool_response.output = "tests passed Authorization: Bearer topsecret";
  recordEvidence(root, "change-code", "go", evidence);
  const stored = JSON.parse(fs.readFileSync(path.join(root, ".hames/contracts/active/change-code/evidence.json")));
  assert.equal(stored.items.test.raw_output, undefined);
  assert.equal(stored.items.test.api_key, undefined);
  assert.doesNotMatch(JSON.stringify(stored), /SECRET/);
  assert.doesNotMatch(JSON.stringify(stored), /topsecret/);
  assert.throws(() => moveToReview(root, "change-code", "go", { outputs: [], limitations: [] }), /mapping|result/i);
  assert.equal(moveToReview(root, "change-code", "go", {
    outputs: [{ requirement: "tests-pass", output: "src/example.js", artifact: "src/example.js" }],
    limitations: [],
  }).status, "REVIEW");
  assert.throws(() => recordEvidence(root, "change-code", "go", evidence), /ACTIVE/);
});

test("hash is canonical, normalizes relative paths, and excludes lifecycle metadata", () => {
  const first = codeSpec();
  first.targets[0].locator = "src/./example.js";
  const reordered = JSON.parse(JSON.stringify(first));
  reordered.status = "ACTIVE";
  reordered.timestamps = { updated_at: "later" };
  reordered.approval = { source: "current_user" };
  assert.equal(computeSpecHash(first), computeSpecHash(reordered));
  reordered.goal = "Different";
  assert.notEqual(computeSpecHash(first), computeSpecHash(reordered));
});

test("go without a task id never chooses the latest contract", () => {
  const root = project();
  createDraft(root, codeSpec("one"), { sessionId: "session-a" });
  createDraft(root, codeSpec("two"), { sessionId: "session-a" });
  approveContract(root, "one", { approved: true, approvedBy: "current-user" });
  approveContract(root, "two", { approved: true, approvedBy: "current-user" });
  const ambiguous = resolveGoCandidate(root, "session-a");
  assert.equal(ambiguous.status, "choose");
  assert.deepEqual(ambiguous.candidates.sort(), ["one", "two"]);
});

test("document and mock service changes require a separate critical confirmation and three-phase evidence", () => {
  for (const type of ["document", "external_service"]) {
    const root = project();
    const taskId = `create-${type.replace("_", "-")}`;
    const spec = codeSpec(taskId);
    spec.targets = [{ id: "remote", type, provider: "mock", resource_kind: type === "document" ? "page" : "record", parent: "workspace", planned_name: taskId }];
    spec.actions = [{ id: "create", target: "remote", kind: "create", risk: "critical", required_evidence: ["before", "action", "after"] }];
    spec.required_evidence = ["before", "action", "after"].map((phase) => ({ id: phase, type: "api_state", action_id: "create", phase, predicate: { status_codes: [phase === "action" ? 201 : 200] } }));
    spec.acceptance_criteria = [{ id: "exists", description: "Remote resource exists", evidence_ids: ["after"] }];
    spec.outputs = [taskId];
    spec.risk = { level: "critical", critical_actions: ["create"] };
    createDraft(root, spec, { sessionId: "ready" });
    approveContract(root, taskId, { approved: true });
    activateContract(root, taskId, { explicitGo: true, sessionId: "go" });
    assert.equal(criticalActionConfirmed(root, taskId, "go", "create"), false);
    confirmCriticalAction(root, taskId, "go", "create", { confirmed: true, expectedImpact: "Creates one mock resource" });
    assert.equal(criticalActionConfirmed(root, taskId, "go", "create"), true);
    for (const [index, phase] of ["before", "action", "after"].entries()) {
      recordEvidence(root, taskId, "go", {
        id: phase,
        target_id: "remote",
        action_id: "create",
        phase,
        observation: {
          source: "hook",
          tool_name: "mcp__mock__get",
          tool_use_id: `tool-${phase}`,
          method: "mock API readback",
          tool_response: {
            resource_id: index === 0 ? "workspace" : `mock:${taskId}`,
            status_code: phase === "action" ? 201 : 200,
            data: phase === "after" ? { parent: "workspace", name: taskId, resource_kind: type === "document" ? "page" : "record", duplicate: false } : {},
          },
        },
      });
    }
    moveToReview(root, taskId, "go", { outputs: [{ requirement: "exists", output: taskId, artifact: `mock:${taskId}` }], limitations: [] });
    assert.equal(acceptAndArchive(root, taskId, "go", { accepted: true }).status, "ARCHIVED");
  }
});

test("contract validation rejects unsafe paths and weakened critical-action rules", () => {
  const unsafe = codeSpec();
  unsafe.targets[0].locator = "../outside.js";
  assert.match(validateSpec(unsafe).errors.join("; "), /traversal/i);

  const remote = codeSpec("weakened");
  remote.targets = [{ id: "service", type: "external_service", provider: "mock", resource_kind: "record", parent: "workspace", planned_name: "record" }];
  remote.actions = [{ id: "send", target: "service", kind: "send", risk: "normal", required_evidence: ["after"] }];
  remote.required_evidence = [{ id: "after", type: "api_state", action_id: "send", phase: "after", predicate: { status_codes: [200] } }];
  remote.acceptance_criteria = [{ id: "sent", description: "Sent", evidence_ids: ["after"] }];
  remote.risk = { level: "normal", critical_actions: [] };
  const errors = validateSpec(remote).errors.join("; ");
  assert.match(errors, /risk: critical/);
  assert.match(errors, /before evidence/);
  assert.match(errors, /action evidence/);
  assert.match(errors, /overall risk|risk level/i);
});

test("evidence must match the declared action, target, and phase", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "go" });
  const wrong = passingTestEvidence();
  wrong.action_id = "other";
  assert.throws(() => recordEvidence(root, "change-code", "go", wrong), /action/i);
  wrong.action_id = "edit";
  wrong.target_id = "other";
  assert.throws(() => recordEvidence(root, "change-code", "go", wrong), /target/i);
});

test("runtime task lookups reject path-like identifiers", () => {
  const root = project();
  assert.throws(() => approveContract(root, "../outside", { approved: true }), /task_id/i);
  assert.throws(() => activateContract(root, "/tmp/outside", { explicitGo: true, sessionId: "go" }), /task_id/i);
});

test("human contract renders every approved specification field and cannot be swapped before approval", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  const directory = path.join(root, ".hames/contracts/active/change-code");
  const markdown = fs.readFileSync(path.join(directory, "contract.md"), "utf8");
  for (const field of ["project", "targets", "actions", "scope", "outputs", "invariants", "acceptance_criteria", "required_evidence", "risk"]) {
    assert.match(markdown, new RegExp(`"${field}"`));
  }
  fs.appendFileSync(path.join(directory, "contract.md"), "\nChanged display\n");
  assert.throws(() => approveContract(root, "change-code", { approved: true }), /display|render|digest/i);
});

test("concurrent activation allows exactly one session", async () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true });
  const barrier = path.join(root, "start-activation");
  const runtime = path.resolve(__dirname, "../../src/runtime/contract.js");
  const childCode = `
    const fs = require("node:fs");
    const { activateContract } = require(process.argv[1]);
    while (!fs.existsSync(process.argv[3])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    try { activateContract(process.argv[2], "change-code", { explicitGo: true, sessionId: process.argv[4] }); console.log("activated"); }
    catch (error) { console.log("blocked:" + error.message); }
  `;
  function run(session) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", childCode, runtime, root, barrier, session], { encoding: "utf8" });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.on("close", () => resolve(output.trim()));
    });
  }
  const runs = [run("one"), run("two")];
  await new Promise((resolve) => setTimeout(resolve, 30));
  fs.writeFileSync(barrier, "go\n");
  const outputs = await Promise.all(runs);
  assert.equal(outputs.filter((item) => item === "activated").length, 1, outputs.join(" | "));
  assert.equal(outputs.filter((item) => item.startsWith("blocked:")).length, 1, outputs.join(" | "));
});

test("one session cannot concurrently activate two different contracts", async () => {
  const root = project();
  for (const taskId of ["task-one", "task-two"]) {
    createDraft(root, codeSpec(taskId), { sessionId: "ready" });
    approveContract(root, taskId, { approved: true });
  }
  const barrier = path.join(root, "start-two-contracts");
  const runtime = path.resolve(__dirname, "../../src/runtime/contract.js");
  const childCode = `
    const fs = require("node:fs");
    const { activateContract } = require(process.argv[1]);
    while (!fs.existsSync(process.argv[3])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    try { activateContract(process.argv[2], process.argv[4], { explicitGo: true, sessionId: "shared" }); console.log("activated"); }
    catch (error) { console.log("blocked:" + error.message); }
  `;
  const run = (taskId) => new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", childCode, runtime, root, barrier, taskId], { encoding: "utf8" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("close", () => resolve(output.trim()));
  });
  const runs = [run("task-one"), run("task-two")];
  await new Promise((resolve) => setTimeout(resolve, 30));
  fs.writeFileSync(barrier, "go\n");
  const outputs = await Promise.all(runs);
  assert.equal(outputs.filter((item) => item === "activated").length, 1, outputs.join(" | "));
  assert.equal(outputs.filter((item) => item.startsWith("blocked:")).length, 1, outputs.join(" | "));
});

test("target identifiers and configured critical categories cannot be weakened", () => {
  const missingProvider = codeSpec("remote-identifiers");
  missingProvider.targets = [{ id: "doc", type: "document", resource_kind: "page", parent: "workspace", planned_name: "Page" }];
  missingProvider.actions = [{ id: "create", target: "doc", kind: "create", risk: "critical", required_evidence: ["before", "action", "after"] }];
  missingProvider.required_evidence = ["before", "action", "after"].map((phase) => ({ id: phase, type: "api_state", action_id: "create", phase, predicate: { status_codes: [200] } }));
  missingProvider.acceptance_criteria = [{ id: "created", description: "Created", evidence_ids: ["after"] }];
  missingProvider.risk = { level: "critical", critical_actions: ["create"] };
  assert.match(validateSpec(missingProvider).errors.join("; "), /provider/);

  const destructive = codeSpec("destructive");
  destructive.actions[0].mutation_mode = "destructive_overwrite";
  assert.match(validateSpec(destructive).errors.join("; "), /risk: critical/);

  const root = project();
  const configFile = path.join(root, ".hames/config.yaml");
  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace('"external_mutation"]', '"external_mutation", "custom_export"]'));
  const custom = codeSpec("custom-risk");
  custom.actions[0].risk_categories = ["custom_export"];
  assert.throws(() => createDraft(root, custom, { sessionId: "ready" }), /risk: critical/);
});

test("review freezes evidence and acceptance rechecks evidence and result integrity", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "go" });
  recordEvidence(root, "change-code", "go", passingTestEvidence());
  moveToReview(root, "change-code", "go", {
    outputs: [{ requirement: "tests-pass", output: "src/example.js", artifact: "src/example.js" }],
    limitations: [],
  });
  const directory = path.join(root, ".hames/contracts/active/change-code");
  const evidenceFile = path.join(directory, "evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile));
  evidence.items.test.status = "failed";
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.throws(() => acceptAndArchive(root, "change-code", "go", { accepted: true }), /evidence/i);

  evidence.items.test.status = "passed";
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.appendFileSync(path.join(directory, "result.md"), "tampered\n");
  assert.throws(() => acceptAndArchive(root, "change-code", "go", { accepted: true }), /result/i);
});

test("activation rejects project policy changes made after approval", () => {
  const root = project();
  createDraft(root, codeSpec(), { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true });
  const configFile = path.join(root, ".hames/config.yaml");
  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace("extensions: {}", 'extensions: {"example": {}}'));
  assert.throws(() => activateContract(root, "change-code", { explicitGo: true, sessionId: "go" }), /configuration changed/i);
});

test("one artifact can satisfy multiple acceptance criteria without duplicate mappings", () => {
  const root = project();
  const spec = codeSpec();
  spec.acceptance_criteria.push({ id: "reviewed", description: "Change was reviewed", evidence_ids: ["test"] });
  createDraft(root, spec, { sessionId: "ready" });
  approveContract(root, "change-code", { approved: true });
  activateContract(root, "change-code", { explicitGo: true, sessionId: "go" });
  recordEvidence(root, "change-code", "go", passingTestEvidence());
  const review = moveToReview(root, "change-code", "go", {
    outputs: [{ requirements: ["tests-pass", "reviewed"], output: "src/example.js", artifact: "src/example.js" }],
    limitations: [],
  });
  assert.equal(review.status, "REVIEW");
});
