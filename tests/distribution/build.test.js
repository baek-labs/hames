const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hames-build-"));
  for (const relative of ["src", "platform"]) {
    fs.cpSync(path.join(ROOT, relative), path.join(root, relative), { recursive: true });
  }
  return root;
}

function filesBelow(root, base = root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      return entry.isDirectory()
        ? filesBelow(absolute, base)
        : [path.relative(base, absolute)];
    })
    .sort();
}

function treeDigest(root) {
  const hash = crypto.createHash("sha256");
  for (const relative of filesBelow(root)) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return hash.digest("hex");
}

test("build emits deterministic Codex and Claude packages from src", () => {
  const isolated = buildFixture();
  const first = spawnSync(process.execPath, [path.join(ROOT, "scripts/build.mjs"), "--root", isolated], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const codexManifest = JSON.parse(fs.readFileSync(
    path.join(isolated, "packages/codex/.codex-plugin/plugin.json"),
  ));
  const claudeManifest = JSON.parse(fs.readFileSync(
    path.join(isolated, "packages/claude/.claude-plugin/plugin.json"),
  ));
  assert.equal(codexManifest.name, "hames");
  assert.equal(claudeManifest.name, "hames");
  assert.deepEqual(filesBelow(path.join(isolated, "packages/codex/skills")), filesBelow(path.join(isolated, "src/skills")));
  assert.deepEqual(filesBelow(path.join(isolated, "packages/claude/skills")), filesBelow(path.join(isolated, "src/skills")));

  for (const relative of filesBelow(path.join(isolated, "src/skills"))) {
    const source = fs.readFileSync(path.join(isolated, "src/skills", relative));
    assert.deepEqual(fs.readFileSync(path.join(isolated, "packages/codex/skills", relative)), source);
    assert.deepEqual(fs.readFileSync(path.join(isolated, "packages/claude/skills", relative)), source);
  }

  const firstDigest = treeDigest(path.join(isolated, "packages"));
  const second = spawnSync(process.execPath, [path.join(ROOT, "scripts/build.mjs"), "--root", isolated], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(treeDigest(path.join(isolated, "packages")), firstDigest);
});

test("marketplaces point to generated packages with explicit policy", () => {
  const codex = JSON.parse(fs.readFileSync(path.join(ROOT, ".agents/plugins/marketplace.json")));
  const claude = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/marketplace.json")));
  assert.equal(codex.plugins[0].source.path, "./packages/codex");
  assert.equal(codex.plugins[0].policy.installation, "AVAILABLE");
  assert.equal(codex.plugins[0].policy.authentication, "ON_INSTALL");
  assert.equal(claude.plugins[0].source, "./packages/claude");
});

test("build can run from a different current directory", () => {
  const isolated = buildFixture();
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/build.mjs"), "--root", isolated], {
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
