const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { applySetup, planSetup } = require("../../src/runtime/setup.js");
const { diagnose } = require("../../src/runtime/doctor.js");
const {
  activateContract,
  createDraft,
  moveToReview,
  presentContract,
  recordEvidence,
  recordIndependentReview,
  recordKnowledgeOutcome,
  recordWorkStep,
  resolveGoCandidate,
  resumeContract,
  validateSpec,
} = require("../../src/runtime/contract.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-experience-"));
  applySetup(planSetup({ root, workspaces: [{ id: "default", path: ".", purpose: "Test workspace" }], projectName: "Experience test", contractTracking: "untracked" }), { approved: true });
  return root;
}

function passingEvidence() {
  return {
    id: "test", target_id: "source", action_id: "edit",
    observation: {
      source: "hook", tool_name: "Bash", tool_use_id: "tool-test", method: "node --test",
      tool_input: { command: "node --test test/example.test.js" },
      tool_response: { exit_code: 0, output: "passed" },
    },
  };
}

function spec(taskId = "improve-flow", reviewRequired = true) {
  return {
    task_id: taskId,
    project: { id: "experience-test", root: ".", config_digest: `sha256:${"0".repeat(64)}` },
    goal: "Improve one bounded workflow",
    targets: [{ id: "source", type: "file", locator: "src/example.js" }],
    actions: [{ id: "edit", target: "source", kind: "update", mutation_mode: "patch", risk: "normal", required_evidence: ["test"] }],
    scope: { allow: ["src/example.js"], deny: ["secrets/**"] },
    outputs: ["src/example.js"],
    invariants: ["Preserve unrelated behavior"],
    acceptance_criteria: [{ id: "works", description: "The workflow works", evidence_ids: ["test"] }],
    required_evidence: [{ id: "test", type: "test", action_id: "edit", command: "node --test test/example.test.js", predicate: { exit_code: 0, output_includes: "passed" } }],
    risk: { level: "normal", critical_actions: [] },
    work_plan: [
      { id: "test-first", description: "Fix expected behavior", depends_on: [], parallel_with: [] },
      { id: "implement", description: "Implement the behavior", depends_on: ["test-first"], parallel_with: [] },
    ],
    review: { required: reviewRequired, reason: reviewRequired ? "Behavior changes" : "Simple reversible edit", scope: ["contract", "diff", "evidence"] },
    knowledge: { destinations: [{ path: "docs/architecture.md", purpose: "Durable product behavior" }], new_discoveries: "propose_before_write" },
  };
}

test("a freshly presented contract activates from one /go without another approval", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "same-session" });
  const ready = presentContract(root, "improve-flow", { sessionId: "same-session" });
  assert.equal(ready.status, "READY");
  assert.equal(ready.approval, null);
  assert.equal(resolveGoCandidate(root, "same-session").status, "activate");

  const active = activateContract(root, "improve-flow", {
    explicitGo: true,
    approvePresented: true,
    sessionId: "same-session",
  });
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.approval.source, "current_user_go");
});

test("presentation is session-bound and an unpresented single candidate is not auto-selected", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "author" });
  presentContract(root, "improve-flow", { sessionId: "author" });
  assert.equal(resolveGoCandidate(root, "other").status, "confirm");
  assert.throws(() => activateContract(root, "improve-flow", {
    explicitGo: true,
    approvePresented: true,
    sessionId: "other",
  }), /presented.*session/i);
  const selected = activateContract(root, "improve-flow", {
    explicitGo: true,
    approveSelected: true,
    sessionId: "other",
  });
  assert.equal(selected.approval.source, "current_user_selection");
});

test("work steps enforce dependencies and retain progress for same-session resume", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  presentContract(root, "improve-flow", { sessionId: "session" });
  activateContract(root, "improve-flow", { explicitGo: true, approvePresented: true, sessionId: "session" });
  assert.throws(() => recordWorkStep(root, "improve-flow", "session", "implement", "completed"), /dependency/i);
  recordWorkStep(root, "improve-flow", "session", "test-first", "completed");
  recordWorkStep(root, "improve-flow", "session", "implement", "in_progress");
  assert.equal(activateContract(root, "improve-flow", { explicitGo: true, sessionId: "session" }).status, "ACTIVE");
  const progress = JSON.parse(fs.readFileSync(path.join(root, ".hames/contracts/active/improve-flow/progress.json"), "utf8"));
  assert.equal(progress.steps.implement.status, "in_progress");
});

test("another session can resume only after an explicit safe handoff", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "one" });
  presentContract(root, "improve-flow", { sessionId: "one" });
  activateContract(root, "improve-flow", { explicitGo: true, approvePresented: true, sessionId: "one" });
  assert.throws(() => resumeContract(root, "improve-flow", "two", {}), /handoff|ended/i);
  const resumed = resumeContract(root, "improve-flow", "two", { takeoverConfirmed: true, previousSessionEnded: true });
  assert.equal(resumed.status, "ACTIVE");
  assert.throws(() => recordWorkStep(root, "improve-flow", "one", "test-first", "completed"), /not linked/i);
  recordWorkStep(root, "improve-flow", "two", "test-first", "completed");
});

test("review policy is explicit and independent review records safe checklist metadata", () => {
  const required = validateSpec(spec()).spec;
  const simple = validateSpec(spec("simple", false)).spec;
  assert.equal(required.review.required, true);
  assert.equal(simple.review.required, false);

  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  presentContract(root, "improve-flow", { sessionId: "session" });
  activateContract(root, "improve-flow", { explicitGo: true, approvePresented: true, sessionId: "session" });
  recordWorkStep(root, "improve-flow", "session", "test-first", "completed");
  recordWorkStep(root, "improve-flow", "session", "implement", "completed");
  recordEvidence(root, "improve-flow", "session", passingEvidence());
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/example.js"), "version one\n");
  assert.throws(() => moveToReview(root, "improve-flow", "session", {
    outputs: [{ requirement: "works", output: "src/example.js", artifact: "src/example.js" }], limitations: [],
  }), /independent review/i);
  const review = recordIndependentReview(root, "improve-flow", "session", {
    reviewer: "independent-reviewer",
    artifacts: [{ id: "source", path: "src/example.js" }],
    items: [{ id: "scope", status: "passed", note: "Contract and diff align" }],
  });
  assert.equal(review.status, "passed");
  assert.equal(review.items.length, 1);
  const evidenceFile = path.join(root, ".hames/contracts/active/improve-flow/evidence.json");
  const changedEvidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  changedEvidence.items.test.method = "changed after review";
  fs.writeFileSync(evidenceFile, `${JSON.stringify(changedEvidence, null, 2)}\n`);
  assert.throws(() => moveToReview(root, "improve-flow", "session", {
    outputs: [{ requirement: "works", output: "src/example.js", artifact: "src/example.js" }], limitations: [],
  }), /review.*current work, evidence, and artifacts/i);
  changedEvidence.items.test.method = "node --test";
  fs.writeFileSync(evidenceFile, `${JSON.stringify(changedEvidence, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "src/example.js"), "version two\n");
  assert.throws(() => moveToReview(root, "improve-flow", "session", {
    outputs: [{ requirement: "works", output: "src/example.js", artifact: "src/example.js" }], limitations: [],
  }), /artifacts/i);
  fs.writeFileSync(path.join(root, "src/example.js"), "version one\n");
  assert.throws(() => moveToReview(root, "improve-flow", "session", {
    outputs: [{ requirement: "works", output: "src/example.js", artifact: "src/example.js" }], limitations: [],
  }), /knowledge outcomes/i);
  assert.throws(() => recordKnowledgeOutcome(root, "improve-flow", "session", { path: "docs/unapproved.md", status: "applied" }), /separate user approval/i);
  recordKnowledgeOutcome(root, "improve-flow", "session", { path: "docs/architecture.md", status: "applied" });
  assert.equal(moveToReview(root, "improve-flow", "session", {
    outputs: [{ requirement: "works", output: "src/example.js", artifact: "src/example.js" }], limitations: [],
  }).status, "REVIEW");
});

test("doctor distinguishes a pending required review from a passing review", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  const reviewCheck = diagnose(root, { pluginRoot: path.resolve(__dirname, "../..") }).checks.find((item) => item.id === "review:active:improve-flow");
  assert.equal(reviewCheck.status, "warn");
  assert.match(reviewCheck.detail, /pending/i);
});

test("three failures at one point stop a work step and remain visible to doctor", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  presentContract(root, "improve-flow", { sessionId: "session" });
  activateContract(root, "improve-flow", { explicitGo: true, approvePresented: true, sessionId: "session" });
  for (let count = 1; count <= 3; count += 1) {
    assert.equal(recordWorkStep(root, "improve-flow", "session", "test-first", "failed", { failurePoint: "same-test", note: `failure ${count}` }).failure_count, count);
  }
  assert.throws(() => recordWorkStep(root, "improve-flow", "session", "test-first", "failed", { failurePoint: "different-test", note: "bypass" }), /three failures/i);
  assert.throws(() => recordWorkStep(root, "improve-flow", "session", "test-first", "in_progress"), /three failures/i);
  assert.equal(diagnose(root).checks.find((item) => item.id === "progress:active:improve-flow").status, "warn");
});

test("stale task locks recover and duplicate session owners fail closed", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  presentContract(root, "improve-flow", { sessionId: "session" });
  activateContract(root, "improve-flow", { explicitGo: true, approvePresented: true, sessionId: "session" });
  const lock = path.join(root, ".hames/state/locks/task-improve-flow.lock");
  fs.writeFileSync(lock, "");
  const old = new Date(Date.now() - 31_000);
  fs.utimesSync(lock, old, old);
  recordWorkStep(root, "improve-flow", "session", "test-first", "completed");

  const sessions = path.join(root, ".hames/state/sessions");
  const original = fs.readdirSync(sessions).find((name) => name.endsWith(".json"));
  const rogue = JSON.parse(fs.readFileSync(path.join(sessions, original), "utf8"));
  rogue.session_id = "rogue";
  const rogueName = `${require("node:crypto").createHash("sha256").update("rogue").digest("hex")}.json`;
  fs.writeFileSync(path.join(sessions, rogueName), `${JSON.stringify(rogue)}\n`);
  assert.throws(() => recordWorkStep(root, "improve-flow", "session", "implement", "in_progress"), /ownership.*ambiguous/i);
  assert.equal(diagnose(root).checks.find((item) => item.id === "session-owner:improve-flow").status, "fail");
});

test("work plans reject unknown or cyclic dependencies", () => {
  const unknown = spec();
  unknown.work_plan[1].depends_on = ["missing"];
  assert.match(validateSpec(unknown).errors.join("; "), /unknown work step/i);

  const cyclic = spec();
  cyclic.work_plan[0].depends_on = ["implement"];
  assert.match(validateSpec(cyclic).errors.join("; "), /cycle/i);

  const contradictory = spec();
  contradictory.work_plan[0].parallel_with = ["implement"];
  assert.match(validateSpec(contradictory).errors.join("; "), /symmetric|depend on and run parallel/i);
});

test("human contract leads with changes, locations, invariants, evidence, and risk", () => {
  const root = project();
  createDraft(root, spec(), { sessionId: "session" });
  const markdown = fs.readFileSync(path.join(root, ".hames/contracts/active/improve-flow/contract.md"), "utf8");
  for (const heading of ["## Changes", "## Deliverable locations", "## Invariants and evidence", "## Work plan", "## Handoff", "## Acceptance criteria"]) assert.match(markdown, new RegExp(heading));
  assert.ok(markdown.indexOf("## Changes") < markdown.indexOf("## Complete specification"));
});
