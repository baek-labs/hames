const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function run(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: "utf8" });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-verify-"));
  for (const relative of [".agents", ".claude-plugin", "src", "platform", "docs"]) {
    fs.cpSync(path.join(ROOT, relative), path.join(root, relative), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(root, "README.md"));
  return root;
}

test("verification rejects a generated file that differs from src", () => {
  const isolated = fixture();
  assert.equal(run("scripts/build.mjs", ["--root", isolated]).status, 0);
  const generated = path.join(isolated, "packages/codex/skills/setup/SKILL.md");
  fs.appendFileSync(generated, "\nTampered.\n");
  const failed = run("scripts/verify.mjs", ["--root", isolated]);
  assert.notEqual(failed.status, 0, failed.stdout);
  assert.match(failed.stderr, /differs|mismatch/i);
  assert.equal(run("scripts/build.mjs", ["--root", isolated]).status, 0);
  assert.equal(run("scripts/verify.mjs", ["--root", isolated]).status, 0);
});

test("schemas and hook configuration are valid JSON", () => {
  for (const relative of [
    "src/schemas/config.schema.json",
    "src/schemas/contract.schema.json",
    "src/hooks/hooks.json",
    "platform/codex/plugin.json",
    "platform/claude/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
  ]) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")), relative);
});
