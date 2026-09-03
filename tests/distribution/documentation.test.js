const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("README explains installation, setup, four commands, hosts, and boundaries", () => {
  const readme = read("README.md");
  assert.match(readme, /install(?:ing|ation).*plugin/is);
  assert.match(readme, /\/setup/);
  assert.match(readme, /\/ready/);
  assert.match(readme, /\/go/);
  assert.match(readme, /\/doctor/);
  assert.match(readme, /Codex.*Claude Code/is);
  assert.match(readme, /code.*document.*browser.*external service/is);
  assert.doesNotMatch(readme, /Hames v2/i);
  assert.doesNotMatch(readme, /frozen reference/i);
});

test("documentation covers architecture, safety, host limits, and extensions", () => {
  for (const relative of [
    "docs/architecture.md",
    "docs/safety.md",
    "docs/host-support.md",
    "docs/extensions.md",
    "docs/development.md",
  ]) assert.ok(fs.statSync(path.join(ROOT, relative)).isFile(), relative);
  assert.match(read("docs/safety.md"), /before.*action.*after/is);
  assert.match(read("docs/safety.md"), /best-effort/i);
  assert.match(read("docs/host-support.md"), /not.*officially supported/is);
  assert.match(read("docs/extensions.md"), /pack/i);
  assert.match(read("docs/development.md"), /src\/.*source of truth/is);
});

test("repository entry rules describe the generated-package boundary", () => {
  for (const relative of ["AGENTS.md", "CLAUDE.md"]) {
    const content = read(relative);
    assert.match(content, /src\//);
    assert.match(content, /packages\/codex/);
    assert.match(content, /packages\/claude/);
    assert.match(content, /generated/i);
    assert.doesNotMatch(content, /CEO|CFO|COO|CSO|CBO|Marketer|AI_COMM|Arsenal/);
  }
});

test("CI covers Linux, macOS, and Windows with the full local verifier", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node --test/);
  assert.match(workflow, /node scripts\/build\.mjs/);
  assert.match(workflow, /node scripts\/verify\.mjs/);
  assert.match(workflow, /fetch-depth:\s*0/, "legacy manifest tests require the public Git history");
});

test("setup documentation explains safe same-folder legacy transition", () => {
  const setup = read("docs/setup.md");
  assert.match(setup, /legacy manifest/i);
  assert.match(setup, /same folder/i);
  assert.match(setup, /secret.*before/is);
  assert.match(setup, /modified.*preserv/is);
  assert.match(setup, /workspace.*confirm/is);
  assert.match(setup, /does not.*\.git/is);
});
