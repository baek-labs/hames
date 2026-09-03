import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootIndex = process.argv.indexOf("--root");
const ROOT = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = ["skills", "hooks", "runtime", "schemas", "templates", "legacy"];
const HOSTS = ["codex", "claude"];

async function readJson(relative) {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, relative), "utf8"));
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error.message}`);
  }
}

async function filesBelow(root, base = root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute, base));
    else if (entry.isFile()) output.push(path.relative(base, absolute).replaceAll(path.sep, "/"));
    else throw new Error(`Unsupported generated entry: ${absolute}`);
  }
  return output.sort();
}

async function verifyManifests() {
  const codex = await readJson("packages/codex/.codex-plugin/plugin.json");
  const claude = await readJson("packages/claude/.claude-plugin/plugin.json");
  for (const [host, manifest] of [["codex", codex], ["claude", claude]]) {
    assert.equal(manifest.name, "hames", `${host} manifest name must be hames`);
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${host} manifest version must be strict semver`);
    assert.equal(typeof manifest.description, "string", `${host} manifest requires description`);
    assert.equal(typeof manifest.author?.name, "string", `${host} manifest requires author.name`);
  }
  assert.equal(codex.skills, "./skills/");
  assert.equal(codex.hooks, undefined, "Codex uses default hooks/hooks.json discovery");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    assert.equal(typeof codex.interface?.[field], "string", `Codex interface requires ${field}`);
  }

  const codexMarket = await readJson(".agents/plugins/marketplace.json");
  const claudeMarket = await readJson(".claude-plugin/marketplace.json");
  const codexEntry = codexMarket.plugins.find((item) => item.name === "hames");
  const claudeEntry = claudeMarket.plugins.find((item) => item.name === "hames");
  assert.equal(codexEntry.source.path, "./packages/codex");
  assert.equal(codexEntry.policy.installation, "AVAILABLE");
  assert.equal(codexEntry.policy.authentication, "ON_INSTALL");
  assert.equal(typeof codexEntry.category, "string");
  assert.equal(claudeEntry.source, "./packages/claude");
}

async function verifyGeneratedFiles() {
  for (const shared of SHARED) {
    const sourceRoot = path.join(ROOT, "src", shared);
    const sourceFiles = await filesBelow(sourceRoot);
    for (const host of HOSTS) {
      const generatedRoot = path.join(ROOT, "packages", host, shared);
      assert.deepEqual(await filesBelow(generatedRoot), sourceFiles, `${host}/${shared} file list differs from src`);
      for (const relative of sourceFiles) {
        const source = await fs.readFile(path.join(sourceRoot, relative));
        const generated = await fs.readFile(path.join(generatedRoot, relative));
        assert.deepEqual(generated, source, `packages/${host}/${shared}/${relative} differs from src`);
      }
    }
  }
  const skillNames = (await fs.readdir(path.join(ROOT, "src/skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(skillNames, ["doctor", "go", "ready", "setup"], "Core must expose exactly four skills");
}

async function verifyJsonSurfaces() {
  for (const relative of [
    "src/schemas/config.schema.json",
    "src/schemas/contract.schema.json",
    "src/hooks/hooks.json",
    "platform/codex/plugin.json",
    "platform/claude/plugin.json",
  ]) await readJson(relative);
  const hooks = await readJson("src/hooks/hooks.json");
  assert.ok(hooks.hooks.SessionStart?.length, "SessionStart hook is required");
  assert.ok(hooks.hooks.PreToolUse?.length, "PreToolUse hook is required");
  assert.ok(hooks.hooks.PostToolUse?.length, "PostToolUse hook is required");
  const registry = await readJson("src/legacy/manifests/registry.json");
  assert.equal(registry.first_commit, "e79ec568e38cc1820045d5b2969ad3ff9e942d62");
  assert.equal(registry.last_commit, "3f2d2db7554cf80966a81df91539225b4f87dd43");
  assert.equal(registry.manifests.length, 9);
  for (const name of registry.manifests) await readJson(`src/legacy/manifests/${name}`);
}

async function textFiles(root) {
  const files = await filesBelow(root);
  return files.filter((name) => /\.(?:js|md|json|yaml|yml)$/.test(name)).map((name) => path.join(root, name));
}

async function verifyNoFixedAssumptions() {
  const roots = [path.join(ROOT, "src"), path.join(ROOT, "platform")];
  const files = [path.join(ROOT, "README.md"), ...await textFiles(path.join(ROOT, "docs"))];
  for (const root of roots) files.push(...(await textFiles(root)).filter((file) => !file.includes(`${path.sep}legacy${path.sep}manifests${path.sep}`) && file !== path.join(ROOT, "src/runtime/legacy.js")));
  const forbidden = /\b(?:CEO|COO|CFO|CSO|CBO|Marketer|AI_COMM|Arsenal|Investment|Perplexity|Naver|Notion)\b|\/Users\/|[A-Za-z]:\\Users\\|Hames v2|v1-legacy/i;
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const match = content.match(forbidden);
    if (match) throw new Error(`${path.relative(ROOT, file)} contains prohibited fixed assumption: ${match[0]}`);
  }
}

await verifyManifests();
await verifyGeneratedFiles();
await verifyJsonSurfaces();
await verifyNoFixedAssumptions();
console.log("Verified manifests, schemas, hooks, generated packages, four-skill Core, and hardcoding boundaries.");
