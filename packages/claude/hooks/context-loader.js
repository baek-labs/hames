#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseConfig, validateConfig } = require("../runtime/config.js");
const { findProjectRoot } = require("./scope-guard.js");

function loadContext(event) {
  const root = findProjectRoot(event.cwd);
  if (!root) return { loaded: false, reason: "hames_not_configured" };
  try {
    const config = parseConfig(fs.readFileSync(path.join(root, ".hames/config.yaml"), "utf8"));
    const validation = validateConfig(config);
    if (!validation.valid) return { loaded: false, reason: `invalid_config: ${validation.errors.join("; ")}` };
    const contextFile = path.join(root, ".hames/context/project.md");
    const durableContext = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, "utf8").slice(0, 5000) : "";
    let active = "No task contract is linked to this session.";
    if (event.session_id) {
      const name = crypto.createHash("sha256").update(event.session_id).digest("hex");
      const pointerFile = path.join(root, ".hames/state/sessions", `${name}.json`);
      if (fs.existsSync(pointerFile)) {
        const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
        active = `Session contract: ${pointer.task_id} revision ${pointer.revision}, hash ${pointer.spec_hash}.`;
      }
    }
    const text = [
      "Hames project context",
      `Project: ${config.project.name}`,
      `Workspaces: ${config.workspaces.join(", ")}`,
      `Guards: ${config.guards.enabled ? "enabled" : "disabled"}`,
      active,
      durableContext,
    ].filter(Boolean).join("\n");
    return { loaded: true, context: text };
  } catch (error) {
    return { loaded: false, reason: error.message };
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
    const result = loadContext(event);
    if (result.loaded) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: result.context } }));
    else if (result.reason !== "hames_not_configured") console.log(JSON.stringify({ systemMessage: `Hames context was not loaded: ${result.reason}` }));
  }).catch((error) => console.log(JSON.stringify({ systemMessage: `Hames context loader failed: ${error.message}` })));
}

module.exports = { loadContext };
