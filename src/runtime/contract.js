#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_CRITICAL_ACTIONS, parseConfig, validateConfig } = require("./config.js");

const TARGET_TYPES = new Set(["file", "document", "record", "web", "external_service"]);
const ACTION_KINDS = new Set(["read", "create", "update", "send", "publish", "delete"]);
const EVIDENCE_TYPES = new Set(["command", "test", "file_diff", "api_state", "browser_state", "checklist"]);
const SPEC_FIELDS = [
  "task_id", "project", "goal", "targets", "actions", "scope", "outputs",
  "invariants", "acceptance_criteria", "required_evidence", "risk", "exceptions",
  "work_plan", "review", "knowledge",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function normalizeRelative(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Relative path must be a non-empty string");
  const slash = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slash) || /^[A-Za-z]:\//.test(slash)) throw new Error(`Absolute path is not allowed: ${value}`);
  const normalized = path.posix.normalize(slash);
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`Path traversal is not allowed: ${value}`);
  return normalized.replace(/^\.\//, "");
}

function normalizedSpec(input) {
  const spec = {};
  for (const field of SPEC_FIELDS) {
    if (input[field] !== undefined) spec[field] = clone(input[field]);
  }
  for (const target of spec.targets || []) {
    if (target.type === "file" && target.locator) target.locator = normalizeRelative(target.locator);
  }
  for (const field of ["allow", "deny"]) {
    if (Array.isArray(spec.scope?.[field])) spec.scope[field] = spec.scope[field].map(normalizeRelative);
  }
  for (const destination of spec.knowledge?.destinations || []) {
    if (destination.path) destination.path = normalizeRelative(destination.path);
  }
  return spec;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function computeSpecHash(input) {
  const json = JSON.stringify(canonicalize(normalizedSpec(input)));
  return `sha256:${crypto.createHash("sha256").update(json).digest("hex")}`;
}

function validateSpec(input, { criticalCategories = DEFAULT_CRITICAL_ACTIONS } = {}) {
  const errors = [];
  const questions = [];
  let spec;
  try { spec = normalizedSpec(input); } catch (error) { return { valid: false, errors: [error.message], questions, spec: null }; }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(spec.task_id || "")) errors.push("task_id must be a safe lowercase identifier");
  if (!spec.project || typeof spec.project.id !== "string" || spec.project.root !== "." || !/^sha256:[a-f0-9]{64}$/.test(spec.project.config_digest || "")) errors.push("project must contain an id, root '.', and config digest");
  if (typeof spec.goal !== "string" || !spec.goal.trim()) errors.push("goal must be a non-empty string");
  if (!Array.isArray(spec.targets) || spec.targets.length === 0) errors.push("targets must not be empty");
  if (!Array.isArray(spec.actions) || spec.actions.length === 0) errors.push("actions must not be empty");
  if (!Array.isArray(spec.required_evidence)) errors.push("required_evidence must be an array");
  if (!Array.isArray(spec.acceptance_criteria) || spec.acceptance_criteria.length === 0) errors.push("acceptance_criteria must not be empty");
  if (!spec.scope || !Array.isArray(spec.scope.allow) || !Array.isArray(spec.scope.deny)) errors.push("scope requires allow and deny arrays");
  if (!Array.isArray(spec.outputs)) errors.push("outputs must be an array");
  if (!Array.isArray(spec.invariants)) errors.push("invariants must be an array");
  if (spec.exceptions !== undefined && !Array.isArray(spec.exceptions)) errors.push("exceptions must be an array when present");

  if (spec.work_plan !== undefined) {
    if (!Array.isArray(spec.work_plan) || spec.work_plan.length === 0) errors.push("work_plan must be a non-empty array when present");
    const stepIds = new Set();
    for (const step of spec.work_plan || []) {
      if (!step.id || stepIds.has(step.id)) errors.push(`work step id is missing or duplicated: ${step.id || "<missing>"}`);
      stepIds.add(step.id);
      if (typeof step.description !== "string" || !step.description.trim()) errors.push(`work step ${step.id || "<missing>"} requires a description`);
      if (!Array.isArray(step.depends_on) || !Array.isArray(step.parallel_with)) errors.push(`work step ${step.id || "<missing>"} requires depends_on and parallel_with arrays`);
    }
    for (const step of spec.work_plan || []) {
      for (const dependency of step.depends_on || []) if (!stepIds.has(dependency)) errors.push(`work step ${step.id} references unknown work step ${dependency}`);
      for (const peer of step.parallel_with || []) if (!stepIds.has(peer)) errors.push(`work step ${step.id} references unknown work step ${peer}`);
      if ((step.parallel_with || []).includes(step.id)) errors.push(`work step ${step.id} cannot run parallel with itself`);
      for (const peer of step.parallel_with || []) {
        if ((step.depends_on || []).includes(peer)) errors.push(`work step ${step.id} cannot depend on and run parallel with ${peer}`);
      }
    }
    const visiting = new Set();
    const visited = new Set();
    const byId = new Map((spec.work_plan || []).map((step) => [step.id, step]));
    for (const step of spec.work_plan || []) for (const peer of step.parallel_with || []) {
      if (byId.has(peer) && !(byId.get(peer).parallel_with || []).includes(step.id)) errors.push(`parallel work steps must be symmetric: ${step.id} and ${peer}`);
    }
    const visit = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id) || !byId.has(id)) return false;
      visiting.add(id);
      if ((byId.get(id).depends_on || []).some(visit)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...byId.keys()].some(visit)) errors.push("work_plan contains a dependency cycle");
  }
  if (spec.review !== undefined) {
    if (typeof spec.review !== "object" || typeof spec.review.required !== "boolean") errors.push("review requires a boolean required field");
    if (typeof spec.review?.reason !== "string" || !spec.review.reason.trim()) errors.push("review requires a reason");
    if (!Array.isArray(spec.review?.scope) || spec.review.scope.length === 0) errors.push("review requires a non-empty scope array");
  }
  if (spec.knowledge !== undefined) {
    if (!Array.isArray(spec.knowledge?.destinations)) errors.push("knowledge requires destinations");
    for (const destination of spec.knowledge?.destinations || []) {
      try { normalizeRelative(destination.path); } catch (error) { errors.push(`knowledge destination is invalid: ${error.message}`); }
      if (typeof destination.purpose !== "string" || !destination.purpose.trim()) errors.push("knowledge destination requires a purpose");
    }
    if (!new Set(["propose_before_write", "contract_approved_only"]).has(spec.knowledge?.new_discoveries)) errors.push("knowledge requires a supported new_discoveries policy");
  }

  const targetIds = new Set();
  for (const target of spec.targets || []) {
    if (!target.id || targetIds.has(target.id)) errors.push(`target id is missing or duplicated: ${target.id || "<missing>"}`);
    targetIds.add(target.id);
    if (!TARGET_TYPES.has(target.type)) errors.push(`unsupported target type: ${target.type}`);
    if (target.type === "file" && !target.locator) errors.push(`file target ${target.id} requires locator`);
    if (new Set(["document", "record", "external_service"]).has(target.type)) {
      if (!target.provider) errors.push(`${target.type} target ${target.id} requires provider`);
      if (!target.resource_kind) errors.push(`${target.type} target ${target.id} requires resource_kind`);
    }
    if (target.type === "web") {
      try {
        const origin = new URL(target.origin);
        if (!new Set(["http:", "https:"]).has(origin.protocol) || origin.origin !== target.origin) throw new Error();
      } catch { errors.push(`web target ${target.id} requires an http(s) origin without path or credentials`); }
      if (typeof target.path !== "string" || !target.path.startsWith("/")) errors.push(`web target ${target.id} requires an absolute URL path`);
    }
  }
  const evidenceIds = new Set();
  for (const evidence of spec.required_evidence || []) {
    if (!evidence.id || evidenceIds.has(evidence.id)) errors.push(`evidence id is missing or duplicated: ${evidence.id || "<missing>"}`);
    evidenceIds.add(evidence.id);
    if (!EVIDENCE_TYPES.has(evidence.type)) errors.push(`unsupported evidence type: ${evidence.type}`);
    if (!evidence.predicate || typeof evidence.predicate !== "object" || Array.isArray(evidence.predicate)) errors.push(`evidence ${evidence.id} requires a machine predicate`);
    if (new Set(["command", "test"]).has(evidence.type) && (typeof evidence.command !== "string" || !Number.isInteger(evidence.predicate?.exit_code))) {
      errors.push(`evidence ${evidence.id} requires a command and integer predicate.exit_code`);
    }
    if (new Set(["command", "test"]).has(evidence.type) && typeof evidence.predicate?.output_includes !== "string" && evidence.predicate?.allow_exit_only !== true) {
      errors.push(`evidence ${evidence.id} must declare output_includes or allow_exit_only`);
    }
  }
  const actionIds = new Set();
  let hasCriticalAction = false;
  for (const action of spec.actions || []) {
    if (!action.id || actionIds.has(action.id)) errors.push(`action id is missing or duplicated: ${action.id || "<missing>"}`);
    actionIds.add(action.id);
    if (!targetIds.has(action.target)) errors.push(`action ${action.id} references an unknown target`);
    if (!ACTION_KINDS.has(action.kind)) errors.push(`unsupported action kind: ${action.kind}`);
    if (!Array.isArray(action.required_evidence) || action.required_evidence.length === 0) errors.push(`action ${action.id} requires evidence`);
    for (const id of action.required_evidence || []) if (!evidenceIds.has(id)) errors.push(`action ${action.id} references unknown evidence ${id}`);
    const target = (spec.targets || []).find((item) => item.id === action.target);
    if (action.risk_categories !== undefined && !Array.isArray(action.risk_categories)) errors.push(`action ${action.id} risk_categories must be an array`);
    const categories = new Set(action.risk_categories || []);
    if (target?.type === "file" && action.kind === "update") {
      if (!new Set(["patch", "replace", "destructive_overwrite"]).has(action.mutation_mode)) errors.push(`file update action ${action.id} requires mutation_mode`);
      if (action.mutation_mode === "destructive_overwrite") categories.add("destructive_overwrite");
    }
    if (action.kind === "delete") categories.add("delete");
    if (action.kind === "send") categories.add("send");
    if (action.kind === "publish") categories.add("publish");
    const remoteMutation = target && target.type !== "file" && action.kind !== "read";
    if (remoteMutation) categories.add("external_mutation");
    const intrinsicallyCritical = [...categories].some((category) => criticalCategories.includes(category));
    if (intrinsicallyCritical || action.risk === "critical") hasCriticalAction = true;
    if (intrinsicallyCritical && action.risk !== "critical") errors.push(`action ${action.id} must be risk: critical`);
    if (target && action.kind === "create" && target.type !== "file") {
      if (!target.parent) questions.push({ target_id: target.id, field: "parent", prompt: `Where should ${target.id} be created?` });
      if (!target.planned_name) questions.push({ target_id: target.id, field: "planned_name", prompt: `What should ${target.id} be named?` });
    } else if (target && target.type !== "file" && target.type !== "web" && !target.locator) {
      errors.push(`existing remote target ${target.id} requires a stable locator`);
    }
    if (remoteMutation && !action.evidence_exception?.user_approved) {
      const phases = new Set((spec.required_evidence || []).filter((item) => item.action_id === action.id).map((item) => item.phase));
      for (const phase of ["before", "action", "after"]) if (!phases.has(phase)) errors.push(`action ${action.id} requires ${phase} evidence`);
    }
    if (action.evidence_exception?.user_approved && !action.evidence_exception.reason) {
      errors.push(`action ${action.id} evidence exception requires a reason`);
    }
  }
  if (!new Set(["normal", "critical"]).has(spec.risk?.level)) errors.push("risk.level must be normal or critical");
  if (!Array.isArray(spec.risk?.critical_actions)) errors.push("risk.critical_actions must be an array");
  if (hasCriticalAction && spec.risk?.level !== "critical") errors.push("overall risk level must be critical when any action is critical");
  for (const evidence of spec.required_evidence || []) {
    if (!actionIds.has(evidence.action_id)) errors.push(`evidence ${evidence.id} references unknown action ${evidence.action_id}`);
  }
  for (const criterion of spec.acceptance_criteria || []) {
    if (!criterion.id || !criterion.description) errors.push("acceptance criterion requires id and description");
    if (!Array.isArray(criterion.evidence_ids) || criterion.evidence_ids.length === 0) errors.push(`criterion ${criterion.id} requires evidence_ids`);
    for (const id of criterion.evidence_ids || []) if (!evidenceIds.has(id)) errors.push(`criterion ${criterion.id} references unknown evidence ${id}`);
  }
  return { valid: errors.length === 0 && questions.length === 0, errors, questions, spec };
}

function contractDirectory(root, taskId, area = "active") {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(taskId || "")) throw new Error("task_id must be a safe lowercase identifier");
  if (!new Set(["active", "archive"]).has(area)) throw new Error("Unknown contract area");
  return path.join(path.resolve(root), ".hames/contracts", area, taskId);
}

function writeAtomic(file, content) {
  const temporary = `${file}.hames-${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function writeJson(file, value) {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendEvent(directory, event) {
  fs.appendFileSync(path.join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function targetLocation(target) {
  if (target.locator) return target.locator;
  if (target.type === "web") return `${target.origin}${target.path}`;
  return [target.provider, target.parent, target.planned_name].filter(Boolean).join(" / ") || target.id;
}

function renderContract(contract) {
  const specification = JSON.stringify(canonicalize(normalizedSpec(contract)), null, 2);
  const lines = [
    `# ${contract.task_id}`,
    "",
    `Status: **${contract.status}**  `,
    `Revision: **${contract.revision}**  `,
    `Specification hash: \`${contract.spec_hash}\``,
    "",
    "## Goal",
    "",
    contract.goal,
    "",
    "## Scope and outputs",
    "",
    `- Allowed: ${(contract.scope?.allow || []).join(", ") || "None"}`,
    `- Denied: ${(contract.scope?.deny || []).join(", ") || "None"}`,
    `- Outputs: ${(contract.outputs || []).map((item) => JSON.stringify(item)).join(", ") || "None"}`,
    "",
    "## Changes",
    "",
    "| Target | Type and location | Action | Risk |",
    "|---|---|---|---|",
    ...(contract.actions || []).map((action) => {
      const target = (contract.targets || []).find((item) => item.id === action.target) || { id: action.target };
      return `| ${markdownCell(target.id)} | ${markdownCell(`${target.type || "unknown"}: ${targetLocation(target)}`)} | ${markdownCell(action.kind)} | ${markdownCell(action.risk)} |`;
    }),
    "",
    "## Deliverable locations",
    "",
    "| Deliverable | Location |",
    "|---|---|",
    ...(contract.outputs || []).map((item, index) => `| ${index + 1} | ${markdownCell(typeof item === "string" ? item : JSON.stringify(item))} |`),
    "",
    "## Invariants and evidence",
    "",
    ...(contract.invariants || []).map((item) => `- Invariant: ${item}`),
    ...(contract.required_evidence || []).map((item) => `- Evidence ${item.id}: ${item.type}${item.command ? ` — ${item.command}` : ""}`),
    `- Overall risk: ${contract.risk?.level || "unspecified"}`,
    "",
    "## Work plan",
    "",
  ];
  if ((contract.work_plan || []).length) {
    lines.push("| Step | Depends on | Parallel with |", "|---|---|---|");
    for (const step of contract.work_plan) lines.push(`| ${step.id}: ${step.description} | ${(step.depends_on || []).join(", ") || "None"} | ${(step.parallel_with || []).join(", ") || "None"} |`);
  } else lines.push("- Follow the declared actions in order.");
  lines.push(
    "",
    "## Review and durable knowledge",
    "",
    `- Independent review: ${contract.review?.required ? `Required (${contract.review.reason})` : `Not required${contract.review?.reason ? ` (${contract.review.reason})` : ""}`}`,
    `- Review scope: ${(contract.review?.scope || []).join(", ") || "Direct verification"}`,
    `- Knowledge destinations: ${(contract.knowledge?.destinations || []).map((item) => `${item.path} (${item.purpose})`).join(", ") || "None"}`,
    "",
    "## Acceptance criteria",
    "",
    ...(contract.acceptance_criteria || []).map((item) => `- ${item.id}: ${item.description}`),
    "",
    "## Complete specification",
    "",
    "```json",
    specification,
    "```",
  );
  return `${lines.join("\n")}\n`;
}

function contentDigest(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function reviewedArtifact(root, input, evidence) {
  const id = redactText(String(input?.id || ""));
  if (!id) throw new Error("Reviewed artifact requires an identifier");
  if (input.path) {
    const relative = normalizeRelative(input.path);
    const projectRoot = fs.realpathSync(path.resolve(root));
    const absolute = fs.realpathSync(path.resolve(root, relative));
    const escaped = path.relative(projectRoot, absolute);
    if (escaped === ".." || escaped.startsWith(`..${path.sep}`) || path.isAbsolute(escaped)) throw new Error("Reviewed artifact escapes the project");
    if (!fs.statSync(absolute).isFile()) throw new Error("Reviewed artifact path must be a file");
    return { id, type: "file", path: relative, digest: contentDigest(fs.readFileSync(absolute)) };
  }
  if (input.evidence_id) {
    const item = evidence.items?.[input.evidence_id];
    if (!item) throw new Error(`Reviewed artifact evidence does not exist: ${input.evidence_id}`);
    return { id, type: "evidence", evidence_id: input.evidence_id, digest: contentDigest(JSON.stringify(canonicalize(item))) };
  }
  throw new Error("Reviewed artifact requires a project path or evidence id");
}

function readContract(root, taskId, area = "active") {
  const directory = contractDirectory(root, taskId, area);
  const contract = JSON.parse(fs.readFileSync(path.join(directory, "contract.json"), "utf8"));
  return { contract, directory };
}

function assertIntegrity(contract) {
  const actual = computeSpecHash(contract);
  if (contract.spec_hash !== actual) throw new Error("Contract specification hash does not match its contents");
}

function projectPolicy(root) {
  const file = path.join(path.resolve(root), ".hames/config.yaml");
  const source = fs.readFileSync(file, "utf8");
  const config = parseConfig(source);
  const validation = validateConfig(config);
  if (!validation.valid) throw new Error(`Project configuration is invalid: ${validation.errors.join("; ")}`);
  return { criticalCategories: config.guards.critical_actions, configDigest: contentDigest(source) };
}

function createDraft(root, input, { sessionId = null } = {}) {
  const policy = projectPolicy(root);
  const preparedInput = clone(input);
  preparedInput.project = { ...preparedInput.project, config_digest: policy.configDigest };
  const validation = validateSpec(preparedInput, { criticalCategories: policy.criticalCategories });
  if (validation.questions.length) return { status: "needs_input", questions: validation.questions, errors: validation.errors };
  if (validation.errors.length) throw new Error(validation.errors.join("; "));
  const directory = contractDirectory(root, validation.spec.task_id);
  if (fs.existsSync(directory)) throw new Error(`Contract already exists: ${validation.spec.task_id}`);
  const createdAt = now();
  const contract = {
    version: 1,
    ...validation.spec,
    revision: 1,
    status: "DRAFT",
    spec_hash: computeSpecHash(validation.spec),
    approval: null,
    timestamps: { created_at: createdAt, updated_at: createdAt },
  };
  const staging = path.join(path.resolve(root), ".hames/state/contract-staging", `${contract.task_id}-${process.pid}`);
  if (fs.existsSync(staging)) throw new Error(`Contract staging path already exists: ${contract.task_id}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    writeJson(path.join(staging, "contract.json"), contract);
    writeAtomic(path.join(staging, "contract.md"), renderContract(contract));
    writeAtomic(path.join(staging, "events.jsonl"), `${JSON.stringify({ type: "created", status: "DRAFT", revision: 1, spec_hash: contract.spec_hash, session_id: sessionId, at: createdAt })}\n`);
    writeJson(path.join(staging, "evidence.json"), { version: 1, task_id: contract.task_id, revision: 1, spec_hash: contract.spec_hash, items: {} });
    writeJson(path.join(staging, "progress.json"), {
      version: 1, task_id: contract.task_id, revision: 1, spec_hash: contract.spec_hash,
      steps: Object.fromEntries((contract.work_plan || []).map((step) => [step.id, { status: "pending", updated_at: createdAt }])),
    });
    writeJson(path.join(staging, "review.json"), { version: 1, task_id: contract.task_id, revision: 1, spec_hash: contract.spec_hash, status: "pending", items: [] });
    writeJson(path.join(staging, "knowledge.json"), { version: 1, task_id: contract.task_id, revision: 1, spec_hash: contract.spec_hash, items: {} });
    writeAtomic(path.join(staging, "result.md"), "# Result\n\nPending execution.\n");
    fs.renameSync(staging, directory);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { status: "created", contract };
}

function presentContract(root, taskId, { sessionId } = {}) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Presentation requires sessionId");
  const { contract, directory } = readContract(root, taskId);
  if (!new Set(["DRAFT", "AMENDMENT_PENDING"]).has(contract.status)) throw new Error("Only a draft contract can be presented");
  assertIntegrity(contract);
  const at = now();
  contract.status = "READY";
  const displayed = renderContract(contract);
  contract.presentation = {
    source: "current_session",
    session_id: sessionId,
    presented_at: at,
    revision: contract.revision,
    spec_hash: contract.spec_hash,
    displayed_contract_digest: contentDigest(displayed),
  };
  return updateContract(directory, contract, { type: "presented", status: "READY", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
}

function updateContract(directory, contract, event) {
  contract.timestamps.updated_at = event.at;
  writeJson(path.join(directory, "contract.json"), contract);
  writeAtomic(path.join(directory, "contract.md"), renderContract(contract));
  appendEvent(directory, event);
  return contract;
}

function approveContract(root, taskId, { approved = false, approvedBy = "current-user" } = {}) {
  if (!approved) throw new Error("Current-user approval is required");
  const { contract, directory } = readContract(root, taskId);
  if (!new Set(["DRAFT", "AMENDMENT_PENDING"]).has(contract.status)) throw new Error("Only DRAFT or AMENDMENT_PENDING contracts can become READY");
  assertIntegrity(contract);
  const displayed = fs.readFileSync(path.join(directory, "contract.md"), "utf8");
  const expectedDisplay = renderContract(contract);
  if (displayed !== expectedDisplay) throw new Error("Human-readable contract display changed before approval");
  const at = now();
  const displayedStatus = contract.status;
  contract.status = "READY";
  contract.approval = { source: "current_user", approved_by: approvedBy, approved_at: at, revision: contract.revision, spec_hash: contract.spec_hash, displayed_status: displayedStatus, displayed_contract_digest: contentDigest(displayed) };
  return updateContract(directory, contract, { type: "approved", status: "READY", revision: contract.revision, spec_hash: contract.spec_hash, at });
}

function sessionFile(root, sessionId) {
  const name = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(path.resolve(root), ".hames/state/sessions", `${name}.json`);
}

function sessionPointers(root) {
  const directory = path.join(path.resolve(root), ".hames/state/sessions");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => {
    const file = path.join(directory, name);
    return { file, pointer: JSON.parse(fs.readFileSync(file, "utf8")) };
  });
}

function assertSession(root, taskId, sessionId, contract) {
  const file = sessionFile(root, sessionId);
  if (!fs.existsSync(file)) throw new Error("This session is not linked to the contract");
  const pointer = JSON.parse(fs.readFileSync(file, "utf8"));
  const owners = sessionPointers(root).filter((item) => item.pointer.task_id === taskId);
  if (owners.length !== 1 || owners[0].file !== file) throw new Error("Contract session ownership is missing or ambiguous");
  if (pointer.session_id !== sessionId || pointer.task_id !== taskId || pointer.spec_hash !== contract.spec_hash || pointer.revision !== contract.revision) {
    throw new Error("Session pointer does not match the contract");
  }
  return { file, pointer };
}

function withStateLock(root, name, metadata, callback) {
  const directory = path.join(path.resolve(root), ".hames/state/locks");
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, `${name}.lock`);
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = fs.openSync(lock, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, ...metadata, created_at: now() })}\n`);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) stale = true;
        else try { process.kill(owner.pid, 0); } catch (processError) { if (processError.code === "ESRCH") stale = true; }
      } catch {
        try { stale = Date.now() - fs.statSync(lock).mtimeMs > 30_000; } catch { stale = false; }
      }
      if (!stale || attempt > 0) throw new Error(`State ${name} is locked by another process`);
      fs.rmSync(lock, { force: true });
    }
  }
  try {
    return callback();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

function withTaskLock(root, taskId, callback) {
  contractDirectory(root, taskId);
  return withStateLock(root, `task-${taskId}`, { task_id: taskId }, callback);
}

function withSessionLock(root, sessionId, callback) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("sessionId is required");
  const key = crypto.createHash("sha256").update(sessionId).digest("hex");
  return withStateLock(root, `session-${key}`, { session_digest: `sha256:${key}` }, callback);
}

function confirmCriticalAction(root, taskId, sessionId, actionId, { confirmed = false, expectedImpact = "" } = {}) {
  if (!confirmed) throw new Error("Critical action confirmation is required at execution time");
  const { contract } = readContract(root, taskId);
  if (contract.status !== "ACTIVE") throw new Error("Critical actions require an ACTIVE contract");
  assertIntegrity(contract);
  const { file, pointer } = assertSession(root, taskId, sessionId, contract);
  const action = contract.actions.find((item) => item.id === actionId);
  if (!action || action.risk !== "critical") throw new Error("The selected action is not a declared critical action");
  if (typeof expectedImpact !== "string" || !expectedImpact.trim()) throw new Error("Critical action confirmation requires the expected impact");
  pointer.critical_confirmations ||= {};
  const confirmedAt = now();
  pointer.critical_confirmations[actionId] = {
    confirmation_id: crypto.randomUUID(),
    task_id: taskId,
    revision: contract.revision,
    spec_hash: contract.spec_hash,
    target_id: action.target,
    action_id: action.id,
    confirmed_at: confirmedAt,
    expires_at: new Date(Date.parse(confirmedAt) + 5 * 60 * 1000).toISOString(),
    expected_impact: redactText(expectedImpact.trim().slice(0, 500)),
  };
  writeJson(file, pointer);
  return pointer.critical_confirmations[actionId];
}

function criticalActionConfirmed(root, taskId, sessionId, actionId) {
  const { contract } = readContract(root, taskId);
  const { pointer } = assertSession(root, taskId, sessionId, contract);
  const confirmation = pointer.critical_confirmations?.[actionId];
  return Boolean(confirmation && confirmation.revision === contract.revision && confirmation.spec_hash === contract.spec_hash && Date.parse(confirmation.expires_at) > Date.now());
}

function recordPendingToolIntent(root, taskId, sessionId, toolUseId, intent, inputDigest) {
  if (typeof toolUseId !== "string" || !toolUseId) throw new Error("External tool intent requires tool_use_id");
  return withTaskLock(root, taskId, () => {
    const { contract } = readContract(root, taskId);
    const { file, pointer } = assertSession(root, taskId, sessionId, contract);
    pointer.pending_tools ||= {};
    if (pointer.pending_tools[toolUseId]) throw new Error("Tool intent is already pending");
    pointer.pending_tools[toolUseId] = { ...intent, input_digest: inputDigest, recorded_at: now() };
    writeJson(file, pointer);
    return pointer.pending_tools[toolUseId];
  });
}

function consumePendingToolIntent(root, taskId, sessionId, toolUseId, inputDigest) {
  return withTaskLock(root, taskId, () => {
    const { contract } = readContract(root, taskId);
    const { file, pointer } = assertSession(root, taskId, sessionId, contract);
    const pending = pointer.pending_tools?.[toolUseId];
    if (!pending || pending.input_digest !== inputDigest) throw new Error("Observed tool call does not match a unique pending contract intent");
    delete pointer.pending_tools[toolUseId];
    writeJson(file, pointer);
    return pending;
  });
}

function consumeCriticalActionConfirmation(root, taskId, sessionId, actionId) {
  return withTaskLock(root, taskId, () => {
    const { contract } = readContract(root, taskId);
    const { file, pointer } = assertSession(root, taskId, sessionId, contract);
    const confirmation = pointer.critical_confirmations?.[actionId];
    const action = contract.actions.find((item) => item.id === actionId && item.risk === "critical");
    if (!action || !confirmation || confirmation.task_id !== taskId || confirmation.target_id !== action.target || confirmation.revision !== contract.revision || confirmation.spec_hash !== contract.spec_hash || Date.parse(confirmation.expires_at) <= Date.now()) {
      throw new Error("Critical action requires a fresh execution-time confirmation");
    }
    delete pointer.critical_confirmations[actionId];
    writeJson(file, pointer);
    return confirmation;
  });
}

function activateContractUnlocked(root, taskId, { explicitGo = false, approvePresented = false, approveSelected = false, sessionId } = {}) {
  if (!explicitGo) throw new Error("An explicit /go request is required");
  if (!sessionId) throw new Error("sessionId is required");
  const { contract, directory } = readContract(root, taskId);
  const linked = sessionPointers(root).find((item) => item.pointer.task_id === taskId);
  if (contract.status === "ACTIVE" && linked?.pointer.session_id === sessionId) {
    assertIntegrity(contract);
    assertSession(root, taskId, sessionId, contract);
    return contract;
  }
  if (contract.status === "ACTIVE" && linked?.pointer.session_id !== sessionId) throw new Error("Contract is active in another session");
  if (contract.status !== "READY") throw new Error("Contract must be READY before activation");
  assertIntegrity(contract);
  if (contract.project.config_digest !== projectPolicy(root).configDigest) throw new Error("Project configuration changed after contract approval");
  if (!contract.approval && approvePresented) {
    const presentation = contract.presentation;
    if (!presentation || presentation.session_id !== sessionId) throw new Error("Contract was not presented in this session");
    if (presentation.revision !== contract.revision || presentation.spec_hash !== contract.spec_hash) throw new Error("Presented contract revision or hash does not match");
    const displayed = fs.readFileSync(path.join(directory, "contract.md"), "utf8");
    if (contentDigest(displayed) !== presentation.displayed_contract_digest || displayed !== renderContract(contract)) throw new Error("Presented contract display changed before /go");
    contract.approval = {
      source: "current_user_go", approved_by: "current-user", approved_at: now(),
      revision: contract.revision, spec_hash: contract.spec_hash,
      displayed_status: "READY", displayed_contract_digest: presentation.displayed_contract_digest,
    };
  }
  if (!contract.approval && approveSelected) {
    const presentation = contract.presentation;
    if (!presentation || presentation.revision !== contract.revision || presentation.spec_hash !== contract.spec_hash) throw new Error("Selected contract has no valid presentation");
    const displayed = fs.readFileSync(path.join(directory, "contract.md"), "utf8");
    if (contentDigest(displayed) !== presentation.displayed_contract_digest || displayed !== renderContract(contract)) throw new Error("Selected contract display changed before confirmation");
    contract.approval = {
      source: "current_user_selection", approved_by: "current-user", approved_at: now(),
      revision: contract.revision, spec_hash: contract.spec_hash,
      displayed_status: "READY", displayed_contract_digest: presentation.displayed_contract_digest,
    };
  }
  if (contract.approval?.source !== "current_user" || contract.approval.spec_hash !== contract.spec_hash || contract.approval.revision !== contract.revision) {
    if (!new Set(["current_user_go", "current_user_selection"]).has(contract.approval?.source) || contract.approval.spec_hash !== contract.spec_hash || contract.approval.revision !== contract.revision) throw new Error("Valid current-user approval is required");
  }
  const approvedDisplay = renderContract({ ...contract, status: contract.approval.displayed_status });
  if (!contract.approval.displayed_contract_digest || contentDigest(approvedDisplay) !== contract.approval.displayed_contract_digest) throw new Error("Approved contract display digest is invalid");
  const ownPointer = sessionFile(root, sessionId);
  if (fs.existsSync(ownPointer)) throw new Error("This session is already linked to a contract");
  if (linked) throw new Error("Contract is active in another session");
  const at = now();
  writeJson(ownPointer, {
    version: 1,
    session_id: sessionId,
    task_id: taskId,
    revision: contract.revision,
    spec_hash: contract.spec_hash,
    project_root: path.resolve(root),
    contract_path: path.relative(path.resolve(root), directory).replaceAll("\\", "/"),
    activated_at: at,
  });
  contract.status = "ACTIVE";
  return updateContract(directory, contract, { type: "activated", status: "ACTIVE", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
}

function activateContract(root, taskId, options = {}) {
  return withSessionLock(root, options.sessionId, () => withTaskLock(root, taskId, () => activateContractUnlocked(root, taskId, options)));
}

function resumeContract(root, taskId, sessionId, { takeoverConfirmed = false, previousSessionEnded = false } = {}) {
  if (!takeoverConfirmed || !previousSessionEnded) throw new Error("A confirmed safe handoff and ended previous session are required");
  return withSessionLock(root, sessionId, () => withTaskLock(root, taskId, () => {
    const { contract, directory } = readContract(root, taskId);
    if (contract.status !== "ACTIVE") throw new Error("Only an ACTIVE contract can be resumed");
    assertIntegrity(contract);
    const destination = sessionFile(root, sessionId);
    if (fs.existsSync(destination)) {
      const interrupted = JSON.parse(fs.readFileSync(destination, "utf8"));
      if (interrupted.task_id !== taskId || interrupted.session_id === sessionId) throw new Error("This session is already linked to a contract");
    }
    const linked = sessionPointers(root).filter((item) => item.pointer.task_id === taskId);
    if (linked.length !== 1) throw new Error("Active contract ownership is missing or ambiguous");
    const at = now();
    const previous = linked[0].pointer;
    if (linked[0].file !== destination) fs.renameSync(linked[0].file, destination);
    writeJson(destination, {
      ...previous,
      session_id: sessionId,
      contract_path: path.relative(path.resolve(root), directory).replaceAll("\\", "/"),
      resumed_at: at,
      previous_session_digest: contentDigest(previous.session_id),
      critical_confirmations: {},
      pending_tools: {},
    });
    appendEvent(directory, { type: "resumed", status: "ACTIVE", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
    return contract;
  }));
}

function recordWorkStep(root, taskId, sessionId, stepId, status, { failurePoint = "", note = "" } = {}) {
  if (!new Set(["pending", "in_progress", "completed", "failed", "blocked"]).has(status)) throw new Error("Unsupported work step status");
  return withTaskLock(root, taskId, () => {
    const { contract, directory } = readContract(root, taskId);
    if (contract.status !== "ACTIVE") throw new Error("Work progress requires an ACTIVE contract");
    assertIntegrity(contract);
    assertSession(root, taskId, sessionId, contract);
    const step = (contract.work_plan || []).find((item) => item.id === stepId);
    if (!step) throw new Error(`Unknown work step: ${stepId}`);
    const file = path.join(directory, "progress.json");
    const progress = JSON.parse(fs.readFileSync(file, "utf8"));
    if (progress.revision !== contract.revision || progress.spec_hash !== contract.spec_hash) throw new Error("Progress store does not match the contract");
    const previous = progress.steps[stepId] || { status: "pending", failure_count: 0 };
    if (previous.stop_required && status !== "blocked") throw new Error("Work step stopped after three failures at the same point");
    if (new Set(["in_progress", "completed"]).has(status)) {
      const incomplete = (step.depends_on || []).filter((id) => progress.steps[id]?.status !== "completed");
      if (incomplete.length) throw new Error(`Work step dependency is incomplete: ${incomplete.join(", ")}`);
    }
    const at = now();
    let failure = {};
    if (status === "failed") {
      if (!failurePoint.trim() || !note.trim()) throw new Error("Failed work steps require a failure point and note");
      const count = previous.failure_point === failurePoint ? Number(previous.failure_count || 0) + 1 : 1;
      failure = { failure_point: redactText(failurePoint.slice(0, 200)), failure_count: count, last_error: redactText(note.slice(0, 500)), stop_required: count >= 3 };
    }
    progress.steps[stepId] = { ...previous, ...failure, status: failure.stop_required ? "blocked" : status, updated_at: at };
    writeJson(file, progress);
    appendEvent(directory, { type: "work_step", step_id: stepId, work_status: progress.steps[stepId].status, failure_count: progress.steps[stepId].failure_count, status: "ACTIVE", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
    return progress.steps[stepId];
  });
}

function recordIndependentReview(root, taskId, sessionId, input) {
  return withTaskLock(root, taskId, () => {
    const { contract, directory } = readContract(root, taskId);
    if (contract.status !== "ACTIVE") throw new Error("Independent review requires an ACTIVE contract");
    assertIntegrity(contract);
    assertSession(root, taskId, sessionId, contract);
    if (!contract.review?.required) throw new Error("Independent review is not required by this contract");
    const items = safeChecklist(input?.items);
    const evidence = JSON.parse(fs.readFileSync(path.join(directory, "evidence.json"), "utf8"));
    const artifacts = Array.isArray(input?.artifacts) ? input.artifacts.map((item) => reviewedArtifact(root, item, evidence)) : [];
    if (!input?.reviewer || !items?.length || !artifacts.length) throw new Error("Independent review requires a reviewer, checklist items, and reviewed artifacts");
    const progress = JSON.parse(fs.readFileSync(path.join(directory, "progress.json"), "utf8"));
    const incomplete = (contract.work_plan || []).filter((step) => progress.steps?.[step.id]?.status !== "completed").map((step) => step.id);
    if (incomplete.length) throw new Error(`Independent review requires completed work steps: ${incomplete.join(", ")}`);
    assertEvidenceComplete(contract, evidence);
    const passed = items.every((item) => item.status === "passed");
    const at = now();
    const review = {
      version: 1, task_id: taskId, revision: contract.revision, spec_hash: contract.spec_hash,
      reviewer: redactText(String(input.reviewer)), scope: clone(contract.review.scope || []),
      items, artifacts, progress_digest: contentDigest(JSON.stringify(canonicalize(progress))),
      evidence_digest: contentDigest(JSON.stringify(canonicalize(evidence))),
      status: passed ? "passed" : "failed", reviewed_at: at,
    };
    writeJson(path.join(directory, "review.json"), review);
    appendEvent(directory, { type: "independent_review", review_status: review.status, status: "ACTIVE", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
    return review;
  });
}

function recordKnowledgeOutcome(root, taskId, sessionId, input) {
  return withTaskLock(root, taskId, () => {
    const { contract, directory } = readContract(root, taskId);
    if (contract.status !== "ACTIVE") throw new Error("Knowledge outcomes require an ACTIVE contract");
    assertIntegrity(contract);
    assertSession(root, taskId, sessionId, contract);
    const relative = normalizeRelative(input?.path);
    const approved = (contract.knowledge?.destinations || []).find((item) => item.path === relative);
    if (!approved && input?.separateApproval !== true) throw new Error("Knowledge destination is outside the contract and requires separate user approval");
    if (!new Set(["applied", "deferred"]).has(input?.status)) throw new Error("Knowledge outcome must be applied or deferred");
    if (input.status === "deferred" && (typeof input.reason !== "string" || !input.reason.trim())) throw new Error("Deferred knowledge requires a reason");
    const file = path.join(directory, "knowledge.json");
    const knowledge = JSON.parse(fs.readFileSync(file, "utf8"));
    if (knowledge.revision !== contract.revision || knowledge.spec_hash !== contract.spec_hash) throw new Error("Knowledge store does not match the contract");
    const at = now();
    knowledge.items[relative] = {
      path: relative,
      purpose: redactText(String(input.purpose || approved?.purpose || "")),
      status: input.status,
      reason: input.reason ? redactText(String(input.reason).slice(0, 500)) : undefined,
      approval: approved ? "contract" : "separate_user",
      updated_at: at,
    };
    writeJson(file, knowledge);
    appendEvent(directory, { type: "knowledge_outcome", path: relative, knowledge_status: input.status, approval: knowledge.items[relative].approval, status: "ACTIVE", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
    return knowledge.items[relative];
  });
}

function safeChecklist(items) {
  if (!Array.isArray(items)) return undefined;
  return items.map((item) => ({ id: String(item.id || ""), status: String(item.status || ""), note: redactText(String(item.note || "").slice(0, 500)) }));
}

function redactText(value) {
  return value
    .replace(/((?:authorization|api[_-]?key|token|password)\s*[:=]\s*(?:bearer\s+)?)([^\s'"]+)/gi, "$1[REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|api_key|key|password)=)[^&\s]+/gi, "$1[REDACTED]");
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function evidencePassedByPhase(items, evidenceIds, phase) {
  return evidenceIds.some((id) => items[id]?.phase === phase && items[id]?.status === "passed");
}

function evaluateEvidence(requirement, input, action, target, existing) {
  const response = input.observation?.tool_response;
  if (!response || typeof response !== "object") throw new Error(`Evidence ${requirement.id} requires an observed tool_response`);
  const common = {
    id: requirement.id,
    type: requirement.type,
    target_id: target.id,
    action_id: action.id,
    phase: requirement.phase,
    method: redactText(String(input.observation.method || input.observation.tool_name || "tool")),
    tool_use_id: redactText(String(input.observation.tool_use_id || "")),
    observed_at: now(),
  };
  let passed = false;
  let detail = {};
  if (new Set(["command", "test"]).has(requirement.type)) {
    const output = typeof response.output === "string" ? response.output : JSON.stringify(response.output ?? "");
    const observedCommand = input.observation.tool_input?.command;
    const includes = requirement.predicate.output_includes;
    const assertionReached = includes === undefined ? requirement.predicate.allow_exit_only === true : output.includes(includes);
    passed = observedCommand === requirement.command && Number.isInteger(response.exit_code) && response.exit_code === requirement.predicate.exit_code && assertionReached;
    detail = { command: redactText(requirement.command), exit_code: response.exit_code, assertions_reached: assertionReached, output_digest: contentDigest(output) };
  } else if (requirement.type === "file_diff") {
    const changed = typeof response.before_digest === "string" && typeof response.after_digest === "string" && response.before_digest !== response.after_digest;
    passed = requirement.predicate.changed === false ? !changed : changed;
    detail = { before_digest: response.before_digest, after_digest: response.after_digest, summary: redactText(String(response.summary || "Observed file digest comparison")) };
  } else if (requirement.type === "api_state") {
    const allowed = requirement.predicate.status_codes || [];
    const expected = requirement.predicate.field_equals || {};
    passed = Number.isInteger(response.status_code) && allowed.includes(response.status_code) && Object.entries(expected).every(([key, value]) => JSON.stringify(valueAt(response.data || {}, key)) === JSON.stringify(value));
    detail = { provider: target.provider, resource_id: response.resource_id, status_code: response.status_code, summary: JSON.stringify(Object.fromEntries(Object.keys(expected).map((key) => [key, valueAt(response.data || {}, key)]))) };
  } else if (requirement.type === "browser_state") {
    const observedOrigin = response.origin || (() => { try { return new URL(response.url).origin; } catch { return null; } })();
    passed = observedOrigin === requirement.predicate.origin && (!requirement.predicate.element || response.element === requirement.predicate.element) && response.observed === true;
    detail = { origin: observedOrigin, element: response.element, summary: redactText(String(response.summary || "Observed browser state")) };
  } else {
    const items = safeChecklist(response.items);
    passed = requirement.predicate.all_passed === true && items?.length > 0 && items.every((item) => item.status === "passed");
    detail = { reviewer: redactText(String(response.reviewer || "")), items };
  }
  if (requirement.phase === "action" && !evidencePassedByPhase(existing, action.required_evidence, "before")) passed = false;
  if (requirement.phase === "after" && (!evidencePassedByPhase(existing, action.required_evidence, "before") || !evidencePassedByPhase(existing, action.required_evidence, "action"))) passed = false;
  const actionObservation = Object.values(existing).find((item) => item.action_id === action.id && item.phase === "action");
  if (requirement.phase === "after" && actionObservation?.resource_id && detail.resource_id !== actionObservation.resource_id) passed = false;
  if (requirement.phase === "action" && action.kind !== "create") {
    const before = Object.values(existing).find((item) => item.action_id === action.id && item.phase === "before");
    if (before?.resource_id && detail.resource_id !== before.resource_id) passed = false;
  }
  if (requirement.phase === "after" && action.kind === "create" && target.type !== "file") {
    passed = passed && response.data?.parent === target.parent && response.data?.name === target.planned_name && response.data?.resource_kind === target.resource_kind && response.data?.duplicate === false;
  }
  return { ...common, ...detail, status: passed ? "passed" : "failed", recorded_at: now() };
}

function recordEvidence(root, taskId, sessionId, input) {
  const { contract, directory } = readContract(root, taskId);
  if (contract.status !== "ACTIVE") throw new Error("Evidence requires an ACTIVE contract");
  assertIntegrity(contract);
  assertSession(root, taskId, sessionId, contract);
  if (input.observation?.source !== "hook" || typeof input.observation.tool_use_id !== "string" || !input.observation.tool_use_id) {
    throw new Error("Evidence must come from an observed hook tool response");
  }
  const requirement = contract.required_evidence.find((item) => item.id === input.id);
  if (!requirement) throw new Error(`Evidence is not required by this contract: ${input.id}`);
  if (requirement.action_id !== input.action_id) throw new Error(`Evidence ${input.id} does not match its declared action`);
  const action = contract.actions.find((item) => item.id === requirement.action_id);
  if (!action || action.target !== input.target_id) throw new Error(`Evidence ${input.id} does not match its declared target`);
  if (requirement.phase && requirement.phase !== input.phase) throw new Error(`Evidence ${input.id} does not match its declared phase`);
  const file = path.join(directory, "evidence.json");
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  if (evidence.spec_hash !== contract.spec_hash || evidence.revision !== contract.revision) throw new Error("Evidence store does not match the contract");
  const target = contract.targets.find((item) => item.id === action.target);
  const safe = evaluateEvidence(requirement, input, action, target, evidence.items);
  evidence.items[input.id] = safe;
  writeJson(file, evidence);
  appendEvent(directory, { type: "evidence_recorded", evidence_id: input.id, status: safe.status, revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at: safe.recorded_at });
  return safe;
}

function evidencePassed(requirement, item) {
  if (!item || item.status !== "passed" || item.type !== requirement.type) return false;
  if (new Set(["command", "test"]).has(item.type)) return Number.isInteger(item.exit_code) && item.assertions_reached === true && Boolean(item.output_digest);
  if (item.type === "file_diff") return Boolean(item.before_digest && item.after_digest && item.summary);
  if (item.type === "api_state") return Number.isInteger(item.status_code) && Boolean(item.resource_id);
  if (item.type === "browser_state") return Boolean(item.origin && item.summary);
  if (item.type === "checklist") return Array.isArray(item.items) && item.items.length > 0 && item.items.every((entry) => entry.status === "passed");
  return false;
}

function assertEvidenceComplete(contract, evidence) {
  if (evidence.task_id !== contract.task_id || evidence.revision !== contract.revision || evidence.spec_hash !== contract.spec_hash) throw new Error("Evidence store linkage does not match the contract");
  const missing = contract.required_evidence.filter((requirement) => !evidencePassed(requirement, evidence.items[requirement.id])).map((item) => item.id);
  if (missing.length) throw new Error(`Missing required evidence: ${missing.join(", ")}`);
  for (const criterion of contract.acceptance_criteria) {
    if (!criterion.evidence_ids.every((id) => evidence.items[id] && evidence.items[id].status === "passed")) throw new Error(`Acceptance criterion lacks passing evidence: ${criterion.id}`);
  }
}

function prepareResult(contract, result, evidence) {
  if (!result || !Array.isArray(result.outputs) || !Array.isArray(result.limitations)) throw new Error("Result requires outputs and limitations arrays");
  const criteria = new Set(contract.acceptance_criteria.map((item) => item.id));
  const declaredOutputs = new Set(contract.outputs.map((item) => JSON.stringify(item)));
  const seenCriteria = new Set();
  const seenOutputs = new Set();
  const seenPairs = new Set();
  const outputs = result.outputs.map((item) => {
    const requirements = item.requirements || [item.requirement];
    const mappedOutputs = item.outputs || [item.output];
    if (!Array.isArray(requirements) || !requirements.length || requirements.some((id) => !criteria.has(id))) throw new Error("Result mapping contains an unknown acceptance criterion");
    if (!Array.isArray(mappedOutputs) || !mappedOutputs.length) throw new Error("Result mapping requires declared outputs");
    const outputKeys = mappedOutputs.map((output) => JSON.stringify(output));
    if (outputKeys.some((key) => !declaredOutputs.has(key))) throw new Error("Result mapping contains an unknown declared output");
    if (typeof item.artifact !== "string" || !item.artifact.trim()) throw new Error("Result artifact identifier is required");
    for (const requirement of requirements) {
      seenCriteria.add(requirement);
      for (const outputKey of outputKeys) {
        const pair = `${requirement}\0${outputKey}`;
        if (seenPairs.has(pair)) throw new Error("Result mapping duplicates a requirement-output pair");
        seenPairs.add(pair);
      }
    }
    for (const outputKey of outputKeys) seenOutputs.add(outputKey);
    const evidenceIds = [...new Set(requirements.flatMap((requirement) => contract.acceptance_criteria.find((entry) => entry.id === requirement).evidence_ids))];
    return {
      requirements: [...requirements],
      outputs: clone(mappedOutputs),
      artifact: redactText(item.artifact.trim()),
      evidence_ids: evidenceIds,
      evidence_digests: Object.fromEntries(evidenceIds.map((id) => [id, contentDigest(JSON.stringify(evidence.items[id]))])),
    };
  });
  if (seenCriteria.size !== criteria.size || seenOutputs.size !== declaredOutputs.size) throw new Error("Result mapping is incomplete");
  return { outputs, limitations: result.limitations.map((item) => redactText(String(item).slice(0, 1000))) };
}

function renderResult(contract, result, knowledge = { items: {} }) {
  const lines = ["# Result", "", `Task: \`${contract.task_id}\``, "", "## Requirement to artifact", ""];
  for (const item of result.outputs || []) lines.push(`- ${item.requirements.join(", ")} → ${JSON.stringify(item.outputs)}: ${item.artifact} [${item.evidence_ids.join(", ")}]`);
  lines.push("", "## Known limitations", "");
  if ((result.limitations || []).length === 0) lines.push("- None reported.");
  else for (const item of result.limitations) lines.push(`- ${item}`);
  lines.push("", "## Durable knowledge", "");
  const knowledgeItems = Object.values(knowledge.items || {});
  if (!knowledgeItems.length) lines.push("- No durable knowledge destinations were declared.");
  else for (const item of knowledgeItems) lines.push(`- ${item.path}: ${item.status}${item.reason ? ` — ${item.reason}` : ""}`);
  return `${lines.join("\n")}\n`;
}

function moveToReview(root, taskId, sessionId, result = {}) {
  const { contract, directory } = readContract(root, taskId);
  if (contract.status !== "ACTIVE") throw new Error("Contract must be ACTIVE before review");
  assertIntegrity(contract);
  const { file: pointerFile, pointer } = assertSession(root, taskId, sessionId, contract);
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, "evidence.json"), "utf8"));
  assertEvidenceComplete(contract, evidence);
  if ((contract.work_plan || []).length) {
    const progress = JSON.parse(fs.readFileSync(path.join(directory, "progress.json"), "utf8"));
    const incomplete = contract.work_plan.filter((step) => progress.steps?.[step.id]?.status !== "completed").map((step) => step.id);
    if (incomplete.length) throw new Error(`Incomplete work plan steps: ${incomplete.join(", ")}`);
  }
  if (contract.review?.required) {
    const review = JSON.parse(fs.readFileSync(path.join(directory, "review.json"), "utf8"));
    const progress = JSON.parse(fs.readFileSync(path.join(directory, "progress.json"), "utf8"));
    const currentProgressDigest = contentDigest(JSON.stringify(canonicalize(progress)));
    const currentEvidenceDigest = contentDigest(JSON.stringify(canonicalize(evidence)));
    const currentArtifacts = (review.artifacts || []).map((item) => reviewedArtifact(root, item, evidence));
    if (review.revision !== contract.revision || review.spec_hash !== contract.spec_hash || review.status !== "passed" || review.progress_digest !== currentProgressDigest || review.evidence_digest !== currentEvidenceDigest || JSON.stringify(currentArtifacts) !== JSON.stringify(review.artifacts)) throw new Error("Required independent review has not passed for the current work, evidence, and artifacts");
  }
  const knowledgeFile = path.join(directory, "knowledge.json");
  const knowledge = fs.existsSync(knowledgeFile)
    ? JSON.parse(fs.readFileSync(knowledgeFile, "utf8"))
    : { version: 1, task_id: contract.task_id, revision: contract.revision, spec_hash: contract.spec_hash, items: {} };
  if (knowledge.revision !== contract.revision || knowledge.spec_hash !== contract.spec_hash) throw new Error("Knowledge store does not match the contract");
  const missingKnowledge = (contract.knowledge?.destinations || []).filter((item) => !new Set(["applied", "deferred"]).has(knowledge.items?.[item.path]?.status)).map((item) => item.path);
  if (missingKnowledge.length) throw new Error(`Missing durable knowledge outcomes: ${missingKnowledge.join(", ")}`);
  const prepared = prepareResult(contract, result, evidence);
  const rendered = renderResult(contract, prepared, knowledge);
  writeAtomic(path.join(directory, "result.md"), rendered);
  contract.result = { digest: contentDigest(rendered), outputs: prepared.outputs, limitations: prepared.limitations, knowledge: clone(knowledge.items) };
  pointer.critical_confirmations = {};
  writeJson(pointerFile, pointer);
  const at = now();
  contract.status = "REVIEW";
  return updateContract(directory, contract, { type: "review_ready", status: "REVIEW", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at });
}

function acceptAndArchive(root, taskId, sessionId, { accepted = false, acceptedBy = "current-user" } = {}) {
  if (!accepted) throw new Error("Current-user acceptance is required");
  const { contract, directory } = readContract(root, taskId);
  if (contract.status !== "REVIEW") throw new Error("Contract must be in REVIEW before acceptance");
  assertIntegrity(contract);
  const { file: pointerFile } = assertSession(root, taskId, sessionId, contract);
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, "evidence.json"), "utf8"));
  assertEvidenceComplete(contract, evidence);
  const resultContent = fs.readFileSync(path.join(directory, "result.md"), "utf8");
  if (!contract.result?.digest || contentDigest(resultContent) !== contract.result.digest) throw new Error("Result document integrity check failed");
  const archive = contractDirectory(root, taskId, "archive");
  if (fs.existsSync(archive)) throw new Error(`Archive target already exists: ${taskId}`);
  const acceptedAt = now();
  contract.status = "ACCEPTED";
  contract.acceptance = { source: "current_user", accepted_by: acceptedBy, accepted_at: acceptedAt };
  updateContract(directory, contract, { type: "accepted", status: "ACCEPTED", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at: acceptedAt });
  fs.renameSync(directory, archive);
  contract.status = "ARCHIVED";
  updateContract(archive, contract, { type: "archived", status: "ARCHIVED", revision: contract.revision, spec_hash: contract.spec_hash, session_id: sessionId, at: now() });
  fs.rmSync(pointerFile, { force: true });
  return contract;
}

function amendContract(root, taskId, changes) {
  const { contract, directory } = readContract(root, taskId);
  assertIntegrity(contract);
  const currentSpec = normalizedSpec(contract);
  const candidate = { ...currentSpec, ...clone(changes), task_id: contract.task_id };
  const policy = projectPolicy(root);
  candidate.project = { ...candidate.project, config_digest: policy.configDigest };
  const validation = validateSpec(candidate, { criticalCategories: policy.criticalCategories });
  if (validation.questions.length) return { status: "needs_input", questions: validation.questions, errors: validation.errors };
  if (validation.errors.length) throw new Error(validation.errors.join("; "));
  for (const field of SPEC_FIELDS) {
    if (validation.spec[field] === undefined) delete contract[field];
    else contract[field] = validation.spec[field];
  }
  contract.revision += 1;
  contract.status = "AMENDMENT_PENDING";
  contract.spec_hash = computeSpecHash(contract);
  contract.approval = null;
  delete contract.acceptance;
  delete contract.result;
  delete contract.presentation;
  for (const item of sessionPointers(root).filter((entry) => entry.pointer.task_id === taskId)) fs.rmSync(item.file, { force: true });
  const at = now();
  writeJson(path.join(directory, "evidence.json"), { version: 1, task_id: taskId, revision: contract.revision, spec_hash: contract.spec_hash, items: {} });
  writeJson(path.join(directory, "progress.json"), {
    version: 1, task_id: taskId, revision: contract.revision, spec_hash: contract.spec_hash,
    steps: Object.fromEntries((contract.work_plan || []).map((step) => [step.id, { status: "pending", updated_at: at }])),
  });
  writeJson(path.join(directory, "review.json"), { version: 1, task_id: taskId, revision: contract.revision, spec_hash: contract.spec_hash, status: "pending", items: [] });
  writeJson(path.join(directory, "knowledge.json"), { version: 1, task_id: taskId, revision: contract.revision, spec_hash: contract.spec_hash, items: {} });
  writeAtomic(path.join(directory, "result.md"), "# Result\n\nPending re-approval and execution.\n");
  return updateContract(directory, contract, { type: "amended", status: "AMENDMENT_PENDING", revision: contract.revision, spec_hash: contract.spec_hash, at });
}

function resolveGoCandidate(root, sessionId) {
  const activeRoot = path.join(path.resolve(root), ".hames/contracts/active");
  if (!fs.existsSync(activeRoot)) return { status: "none", candidates: [] };
  const candidates = [];
  const presented = [];
  const errors = [];
  for (const taskId of fs.readdirSync(activeRoot)) {
    const directory = path.join(activeRoot, taskId);
    if (!fs.statSync(directory).isDirectory()) continue;
    try {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(taskId)) throw new Error("invalid task directory name");
      const contract = JSON.parse(fs.readFileSync(path.join(directory, "contract.json"), "utf8"));
      assertIntegrity(contract);
      if (contract.status !== "READY") continue;
      candidates.push(taskId);
      if (contract.presentation?.session_id === sessionId && contract.presentation.revision === contract.revision && contract.presentation.spec_hash === contract.spec_hash) presented.push(taskId);
    } catch (error) {
      errors.push(`${taskId}: ${error.message}`);
    }
  }
  if (errors.length) return { status: "error", candidates, errors };
  if (presented.length === 1) return { status: "activate", candidate: presented[0], candidates };
  if (candidates.length === 1) return { status: "confirm", candidate: candidates[0], candidates };
  if (candidates.length > 1) return { status: "choose", candidates };
  return { status: "none", candidates: [] };
}

function cli() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      const next = args[index + 1];
      options[args[index].slice(2)] = !next || next.startsWith("--") ? true : args[++index];
    }
  }
  const root = options.root || process.cwd();
  const readInput = (name) => JSON.parse(fs.readFileSync(options[name], "utf8"));
  const enabled = (name) => options[name] === true || options[name] === "true";
  if (command === "draft") return createDraft(root, readInput("spec"), { sessionId: options.session });
  if (command === "amend") return amendContract(root, options.task, readInput("changes"));
  if (command === "present") return presentContract(root, options.task, { sessionId: options.session });
  if (command === "approve") return approveContract(root, options.task, { approved: enabled("approved"), approvedBy: options.by });
  if (command === "activate") return activateContract(root, options.task, { explicitGo: enabled("explicit-go"), approvePresented: enabled("approve-presented"), approveSelected: enabled("approve-selected"), sessionId: options.session });
  if (command === "resume") return resumeContract(root, options.task, options.session, { takeoverConfirmed: enabled("takeover-confirmed"), previousSessionEnded: enabled("previous-session-ended") });
  if (command === "step") return recordWorkStep(root, options.task, options.session, options.step, options.status, { failurePoint: options["failure-point"], note: options.note });
  if (command === "record-review") return recordIndependentReview(root, options.task, options.session, readInput("review"));
  if (command === "record-knowledge") return recordKnowledgeOutcome(root, options.task, options.session, readInput("knowledge"));
  if (command === "record-knowledge") return recordKnowledgeOutcome(root, options.task, options.session, readInput("knowledge"));
  if (command === "confirm-critical") return confirmCriticalAction(root, options.task, options.session, options.action, { confirmed: enabled("confirmed"), expectedImpact: options.impact });
  if (command === "review") return moveToReview(root, options.task, options.session, readInput("result"));
  if (command === "accept") return acceptAndArchive(root, options.task, options.session, { accepted: enabled("accepted"), acceptedBy: options.by });
  if (command === "candidate") return resolveGoCandidate(root, options.session);
  throw new Error("Unknown command. Use draft, amend, present, approve, activate, resume, step, record-review, record-knowledge, confirm-critical, review, accept, or candidate.");
}

if (require.main === module) {
  try { console.log(JSON.stringify(cli(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

module.exports = {
  acceptAndArchive,
  activateContract,
  amendContract,
  approveContract,
  confirmCriticalAction,
  computeSpecHash,
  consumePendingToolIntent,
  consumeCriticalActionConfirmation,
  createDraft,
  criticalActionConfirmed,
  moveToReview,
  normalizeRelative,
  presentContract,
  readContract,
  recordIndependentReview,
  recordKnowledgeOutcome,
  recordKnowledgeOutcome,
  recordPendingToolIntent,
  recordWorkStep,
  recordEvidence,
  resolveGoCandidate,
  resumeContract,
  validateSpec,
};
