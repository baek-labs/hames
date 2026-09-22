#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseConfig, validateConfig } = require("../runtime/config.js");
const { findProjectRoot } = require("./scope-guard.js");

function loadContext(event) {
  const root = findProjectRoot(event.cwd);
  if (!root) return { loaded:true, onboarding:true, context:"Hames first use: this folder is not configured. Start the setup conversation: confirm the intended AI work root, ask what workspace folders and roles the user wants, offer editable examples one decision at a time, then show the full preview before writing. Do not create default folders silently. If the user declines setup, do not keep asking in this conversation. Use the Hames setup skill. Hames includes its execution workflows; no separate DryForge installation or Git initialization is required." };
  try { return require("../runtime/context.js").selectContext(root, {cwd:event.cwd,sessionId:event.session_id,workspace:event.workspace}); }
  catch(error) {return {loaded:false,reason:error.message};}
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
