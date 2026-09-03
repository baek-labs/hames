#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { consumePendingToolIntent, recordEvidence } = require("../runtime/contract.js");
const { findProjectRoot } = require("./scope-guard.js");

function sessionPointer(root, sessionId) {
  const name = crypto.createHash("sha256").update(sessionId).digest("hex");
  const file = path.join(root, ".hames/state/sessions", `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function evidenceInput(requirement, event) {
  const input = event.tool_input || {};
  return {
    id: requirement.id,
    target_id: input.hames_target_id,
    action_id: input.hames_action_id,
    phase: requirement.phase,
    observation: {
      source: "hook",
      tool_name: event.tool_name,
      tool_use_id: event.tool_use_id,
      method: input.hames_method || event.tool_name,
      tool_input: event.tool_input,
      tool_response: event.tool_response,
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function toolInputDigest(input) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(input || {}))).digest("hex")}`;
}

function captureHookEvidence(event) {
  const root = findProjectRoot(event.cwd);
  if (!root || !event.session_id) return { recorded: false, reason: "no_hames_session" };
  try {
    const pointer = sessionPointer(root, event.session_id);
    if (!pointer) return { recorded: false, reason: "no_contract_pointer" };
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(pointer.task_id || "")) return { recorded: false, reason: "invalid_task_id" };
    const expectedPath = `.hames/contracts/active/${pointer.task_id}`;
    if (pointer.contract_path !== expectedPath || path.resolve(pointer.project_root || "") !== path.resolve(root)) {
      return { recorded: false, reason: "pointer_path_mismatch" };
    }
    const contract = JSON.parse(fs.readFileSync(path.join(root, expectedPath, "contract.json"), "utf8"));
    let evidenceId = event.tool_input?.hames_evidence_id;
    let selected = null;
    if (event.tool_use_id && pointer.pending_tools?.[event.tool_use_id]) {
      selected = consumePendingToolIntent(root, pointer.task_id, event.session_id, event.tool_use_id, toolInputDigest(event.tool_input));
      if (evidenceId && evidenceId !== selected.evidence_id) throw new Error("Explicit evidence id conflicts with the unique pending tool intent");
      evidenceId = selected.evidence_id;
    }
    if (!evidenceId) return { recorded: false, reason: "no_evidence_match" };
    const requirement = contract.required_evidence.find((item) => item.id === evidenceId);
    if (!requirement) return { recorded: false, reason: "evidence_not_required" };
    const input = evidenceInput(requirement, event);
    if (selected) {
      input.target_id = selected.target_id;
      input.action_id = selected.action_id;
      input.phase = selected.phase;
    }
    const stored = recordEvidence(root, pointer.task_id, event.session_id, input);
    return { recorded: true, evidence_id: stored.id };
  } catch (error) {
    return { recorded: false, reason: error.message };
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(input || "{}")); } catch (error) { reject(error); }
    });
    process.stdin.on("error", reject);
  });
}

if (require.main === module) {
  readStdin().then((event) => {
    const result = captureHookEvidence(event);
    if (!result.recorded && result.reason !== "no_evidence_match") {
      console.log(JSON.stringify({ systemMessage: `Hames evidence was not recorded: ${result.reason}` }));
    }
  }).catch((error) => console.log(JSON.stringify({ systemMessage: `Hames evidence hook failed: ${error.message}` })));
}

module.exports = { captureHookEvidence };
