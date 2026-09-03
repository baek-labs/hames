#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { computeSpecHash, consumeCriticalActionConfirmation, criticalActionConfirmed, recordPendingToolIntent } = require("../runtime/contract.js");

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".hames/config.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveInsideRoot(root, candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error("Target path is missing");
  const projectRoot = fs.realpathSync(path.resolve(root));
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const lexicalRelative = path.relative(path.resolve(root), absolute);
  if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Target is outside the project: ${candidate}`);
  }
  let ancestor = absolute;
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve target path: ${candidate}`);
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  const resolved = path.join(realAncestor, ...suffix);
  const realRelative = path.relative(projectRoot, resolved);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Target escapes the project through a symlink: ${candidate}`);
  }
  return { absolute: resolved, relative: realRelative.replaceAll(path.sep, "/") || "." };
}

function patternRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`);
}

function matches(relative, patterns) {
  return patterns.some((pattern) => patternRegex(pattern).test(relative));
}

function pointerFor(root, sessionId) {
  if (!sessionId) return null;
  const name = crypto.createHash("sha256").update(sessionId).digest("hex");
  const file = path.join(root, ".hames/state/sessions", `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function pathsFromPatch(command) {
  return [...String(command || "").matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File:|Move to:) (.+)$/gm)].map((match) => match[1].trim());
}

function pathsFromShell(command) {
  const text = String(command || "");
  if (!/(^|[;&|]\s*|\s)(rm|mv|cp|touch|mkdir|tee|truncate|install|ln|cat|head|tail|less|more|grep|rg)\s|(?:^|[^>])>{1,2}\s*/.test(text)) return [];
  const targets = [];
  for (const match of text.matchAll(/(?:^|[;&|]\s*|\s)(?:rm|touch|mkdir|truncate|install|ln)\s+(?:-[^\s]+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    targets.push(match[1].replace(/^['"]|['"]$/g, ""));
  }
  for (const match of text.matchAll(/(?:^|[;&|]\s*|\s)(?:mv|cp)\s+(?:-[^\s]+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    targets.push(match[1], match[2]);
  }
  for (const match of text.matchAll(/>{1,2}\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) targets.push(match[1]);
  for (const match of text.matchAll(/(?:^|[;&|]\s*|\s)(?:cat|head|tail|less|more)\s+(?:-[^\s]+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) targets.push(match[1]);
  for (const match of text.matchAll(/(?:^|[;&|]\s*|\s)(?:grep|rg)\s+(?:-[^\s]+\s+)*(?:"[^"]+"|'[^']+'|[^\s;&|]+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) targets.push(match[1]);
  return targets.map((item) => item.replace(/^['"]|['"]$/g, ""));
}

function toolPaths(event) {
  const input = event.tool_input || {};
  if (event.tool_name === "apply_patch") return pathsFromPatch(input.command);
  if (event.tool_name === "Bash") return pathsFromShell(input.command);
  return [input.file_path, input.path, input.notebook_path, input.target_file].filter(Boolean);
}

function inferredKind(event, resolvedPath = null) {
  const name = String(event.tool_name || "").toLowerCase();
  const command = String(event.tool_input?.command || "");
  if (new Set(["read", "glob", "grep"]).has(name)) return "read";
  if (name === "write") return resolvedPath && fs.existsSync(resolvedPath) ? "update" : "create";
  if (new Set(["edit", "multiedit", "notebookedit"]).has(name)) return "update";
  if (name === "apply_patch") {
    if (/^\*\*\* Delete File:/m.test(command)) return "delete";
    if (/^\*\*\* Add File:/m.test(command)) return "create";
    return "update";
  }
  if (name === "bash") {
    if (/(^|[;&|]\s*|\s)rm\s/.test(command)) return "delete";
    if (/(^|[;&|]\s*|\s)(?:touch|mkdir|install|ln)\s/.test(command)) return "create";
    if (/(^|[;&|]\s*|\s)(?:cat|head|tail|less|more|grep|rg)\s/.test(command)) return "read";
    return toolPaths(event).length ? "update" : "read";
  }
  if (/(?:^|[_-])(?:send|email|submit)(?:$|[_-])/.test(name)) return "send";
  if (/(?:^|[_-])(?:publish|deploy)(?:$|[_-])/.test(name)) return "publish";
  if (/(?:^|[_-])(?:delete|remove)(?:$|[_-])/.test(name)) return "delete";
  if (/(?:^|[_-])(?:create|add|insert)(?:$|[_-])/.test(name)) return "create";
  if (/(?:^|[_-])(?:update|edit|write|set|move)(?:$|[_-])/.test(name)) return "update";
  if (/(?:^|[_-])(?:read|get|fetch|list|search|find)(?:$|[_-])/.test(name)) return "read";
  return null;
}

function inferredMutationMode(event) {
  const name = String(event.tool_name || "").toLowerCase();
  const command = String(event.tool_input?.command || "");
  if (new Set(["edit", "multiedit", "notebookedit", "apply_patch"]).has(name)) return "patch";
  if (name === "write") return "replace";
  if (name === "bash" && /\bsed\s+-i\b/.test(command)) return "patch";
  if (name === "bash" && (/>|\b(?:cp|mv|truncate|install)\b/.test(command))) return "replace";
  return null;
}

function structuredTargetMatches(target, input, toolName) {
  const provider = String(toolName || "").split("__")[1] || null;
  if (target.provider && provider !== String(target.provider).toLowerCase()) return false;
  if (target.account && input.account !== target.account) return false;
  if (target.type === "web") {
    try {
      const observed = input.url ? new URL(input.url) : new URL(input.path, input.origin);
      return observed.origin === target.origin && observed.pathname === target.path;
    } catch { return false; }
  }
  if (target.locator) {
    const keys = target.type === "document"
      ? ["document_id", "page_id", "id"]
      : target.type === "record" ? ["record_id", "id"] : ["resource_id", "id"];
    return keys.some((key) => input[key] === target.locator);
  }
  const parentValue = input.parent ?? input.parent_id ?? input.folder_id ?? input.database_id;
  const parent = typeof parentValue === "string" ? parentValue : parentValue?.database_id ?? parentValue?.page_id ?? parentValue?.folder_id ?? parentValue?.id;
  const name = input.name ?? input.planned_name ?? input.title;
  const resourceKind = input.resource_kind ?? input.type ?? (String(toolName).toLowerCase().includes(String(target.resource_kind).toLowerCase()) ? target.resource_kind : null);
  return parent === target.parent && name === target.planned_name && resourceKind === target.resource_kind;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function toolInputDigest(input) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(input || {}))).digest("hex")}`;
}

function providerFromTool(toolName) {
  return String(toolName || "").split("__")[1]?.toLowerCase() || null;
}

function inputIds(input) {
  const ids = [];
  for (const [key, value] of Object.entries(input || {})) {
    if ((key === "id" || key.endsWith("_id")) && typeof value === "string") ids.push(value);
    if (value && typeof value === "object" && !Array.isArray(value)) ids.push(...inputIds(value));
  }
  return ids;
}

function targetMatchesPhase(target, action, phase, input, toolName, evidenceItems) {
  if (target.provider && providerFromTool(toolName) !== String(target.provider).toLowerCase()) return false;
  if (target.account && input.account !== target.account) return false;
  if (target.type === "web") return structuredTargetMatches(target, input, toolName);
  const ids = inputIds(input);
  if (action.kind === "create" && phase === "before") return ids.includes(target.parent);
  if (action.kind === "create" && phase === "after") {
    const actionEvidence = Object.values(evidenceItems).find((item) => item.action_id === action.id && item.phase === "action" && item.status === "passed");
    return Boolean(actionEvidence?.resource_id && ids.includes(actionEvidence.resource_id));
  }
  if (phase === "action" && action.kind === "create") return structuredTargetMatches(target, input, toolName);
  return Boolean(target.locator && ids.includes(target.locator));
}

function unmetRequirements(contract, action, evidenceItems, phase) {
  return contract.required_evidence.filter((item) => action.required_evidence.includes(item.id) && item.phase === phase && evidenceItems[item.id]?.status !== "passed");
}

function selectExternalIntent(contract, event, evidenceItems) {
  const observedKind = inferredKind(event);
  const candidates = [];
  for (const action of contract.actions) {
    const target = contract.targets.find((item) => item.id === action.target);
    if (!target || target.type === "file") continue;
    if (event.tool_input?.hames_target_id && event.tool_input.hames_target_id !== target.id) continue;
    if (event.tool_input?.hames_action_id && event.tool_input.hames_action_id !== action.id) continue;
    let phase = null;
    if (observedKind === action.kind) {
      if (unmetRequirements(contract, action, evidenceItems, "before").length) continue;
      phase = "action";
    } else if (observedKind === "read") {
      if (unmetRequirements(contract, action, evidenceItems, "before").length) phase = "before";
      else if (!unmetRequirements(contract, action, evidenceItems, "action").length && unmetRequirements(contract, action, evidenceItems, "after").length) phase = "after";
      else if (action.kind === "read") phase = undefined;
      else continue;
    } else continue;
    const requirements = phase === undefined
      ? contract.required_evidence.filter((item) => action.required_evidence.includes(item.id) && evidenceItems[item.id]?.status !== "passed")
      : unmetRequirements(contract, action, evidenceItems, phase);
    if (requirements.length !== 1 || !targetMatchesPhase(target, action, phase, event.tool_input || {}, event.tool_name, evidenceItems)) continue;
    candidates.push({ target, action, requirement: requirements[0], phase });
  }
  return candidates;
}

function deny(reason) {
  return { allowed: false, reason };
}

function guardToolUse(event) {
  const root = findProjectRoot(event.cwd);
  if (!root) return { allowed: true, reason: "hames_not_configured" };
  let session;
  try { session = pointerFor(root, event.session_id); }
  catch (error) { return deny(`Session state is invalid: ${error.message}`); }
  if (!session) return { allowed: true, reason: "no_session_contract" };
  const pointer = session.value;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(pointer.task_id || "")) return deny("Session pointer contains an invalid task id");
  const expectedPath = `.hames/contracts/active/${pointer.task_id}`;
  if (pointer.contract_path !== expectedPath || path.resolve(pointer.project_root || "") !== path.resolve(root)) {
    return deny("Session pointer project or contract path mismatch");
  }
  const contractFile = path.join(root, expectedPath, "contract.json");
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
    if (contract.status !== "ACTIVE" && contract.status !== "REVIEW") return deny("Session contract is not ACTIVE or REVIEW");
    if (contract.spec_hash !== computeSpecHash(contract)) return deny("Contract integrity hash mismatch");
    if (pointer.spec_hash !== contract.spec_hash || pointer.revision !== contract.revision || pointer.task_id !== contract.task_id) return deny("Session pointer and contract do not match");
  } catch (error) {
    return deny(`Contract integrity check failed: ${error.message}`);
  }

  const input = event.tool_input || {};
  let structuredTarget = null;
  let structuredAction = null;
  if (input.hames_target_id || input.hames_action_id) {
    structuredTarget = contract.targets.find((item) => item.id === input.hames_target_id);
    structuredAction = contract.actions.find((item) => item.id === input.hames_action_id && item.target === input.hames_target_id);
    if (!structuredTarget || !structuredAction) return deny("Structured tool target or action is outside the contract");
  }

  const candidates = toolPaths(event);
  if (candidates.length === 0) {
    if (String(event.tool_name || "").startsWith("mcp__") || structuredAction) {
      let evidenceItems;
      try { evidenceItems = JSON.parse(fs.readFileSync(path.join(path.dirname(contractFile), "evidence.json"), "utf8")).items; }
      catch (error) { return deny(`Cannot read contract evidence state: ${error.message}`); }
      const matches = selectExternalIntent(contract, event, evidenceItems);
      if (matches.length !== 1) return deny(matches.length === 0 ? "No external contract target/action/evidence phase matches this tool call" : "Multiple external contract intents match this tool call; selection is ambiguous");
      const selected = matches[0];
      const observedKind = inferredKind(event);
      if (contract.status === "REVIEW" && observedKind !== "read") return deny("REVIEW contracts are read-only");
      if (selected.action.risk === "critical" && observedKind === selected.action.kind) {
        if (!criticalActionConfirmed(root, contract.task_id, event.session_id, selected.action.id)) return deny("Critical action requires separate execution-time confirmation");
        try { consumeCriticalActionConfirmation(root, contract.task_id, event.session_id, selected.action.id); }
        catch (error) { return deny(error.message); }
      }
      try {
        recordPendingToolIntent(root, contract.task_id, event.session_id, event.tool_use_id, { target_id: selected.target.id, action_id: selected.action.id, evidence_id: selected.requirement.id, phase: selected.phase }, toolInputDigest(input));
      } catch (error) { return deny(error.message); }
      return { allowed: true, reason: "unique_external_contract_match", target_id: selected.target.id, action_id: selected.action.id, evidence_id: selected.requirement.id };
    }
    return { allowed: true, reason: event.tool_name === "Bash" ? "bash_best_effort_no_path" : "unstructured_tool" };
  }
  const allowedPatterns = [...(contract.scope?.allow || []), ...contract.targets.filter((item) => item.type === "file").map((item) => item.locator)];
  const deniedPatterns = contract.scope?.deny || [];
  let criticalAction = null;
  for (const candidate of candidates) {
    let resolved;
    try { resolved = resolveInsideRoot(root, candidate); }
    catch (error) { return deny(error.message); }
    if (matches(resolved.relative, deniedPatterns)) return deny(`Target is explicitly denied: ${resolved.relative}`);
    if (!matches(resolved.relative, allowedPatterns)) return deny(`Target is outside the approved file scope: ${resolved.relative}`);
    const target = structuredTarget || contract.targets.find((item) => item.type === "file" && matches(resolved.relative, [item.locator]));
    if (!target || target.type !== "file" || !matches(resolved.relative, [target.locator])) return deny("Observed file does not match a declared contract target");
    const observedKind = inferredKind(event, resolved.absolute);
    if (contract.status === "REVIEW" && observedKind !== "read") return deny("REVIEW contracts are read-only");
    const action = structuredAction || contract.actions.find((item) => item.target === target.id && item.kind === observedKind);
    if (!observedKind || !action || action.target !== target.id || action.kind !== observedKind) return deny("Observed file action kind does not match the contract");
    if (action.kind === "update") {
      const observedMode = inferredMutationMode(event);
      const expectedMode = action.mutation_mode === "destructive_overwrite" ? "replace" : action.mutation_mode;
      if (!observedMode || observedMode !== expectedMode) return deny("Observed file mutation mode does not match the contract");
    }
    if (action.risk === "critical") criticalAction = action;
  }
  if (criticalAction) {
    if (!criticalActionConfirmed(root, contract.task_id, event.session_id, criticalAction.id)) return deny("Critical file action requires separate execution-time confirmation");
    try { consumeCriticalActionConfirmation(root, contract.task_id, event.session_id, criticalAction.id); }
    catch (error) { return deny(error.message); }
  }
  return { allowed: true, reason: "file_scope_match" };
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
    const result = guardToolUse(event);
    if (!result.allowed) {
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: result.reason } }));
    }
  }).catch((error) => {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Hames scope guard failed: ${error.message}` } }));
  });
}

module.exports = { findProjectRoot, guardToolUse, resolveInsideRoot };
