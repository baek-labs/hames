import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootIndex = process.argv.indexOf("--root");
const ROOT = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = path.join(ROOT, "packages");
const STAGING = path.join(ROOT, `.packages-staging-${process.pid}`);
const PREVIOUS = path.join(ROOT, `.packages-previous-${process.pid}`);
const LOCK = path.join(ROOT, ".packages-build.lock");
let lockHandle = null;

async function acquireLock() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      lockHandle = await fs.open(LOCK, "wx", 0o600);
      await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - await fs.stat(LOCK).then((stat) => stat.mtimeMs, () => Date.now());
      if (age > 30_000) await fs.rm(LOCK, { force: true });
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Timed out waiting for the package build lock");
}

async function releaseLock() {
  if (!lockHandle) return;
  await lockHandle.close().catch(() => {});
  lockHandle = null;
  await fs.rm(LOCK, { force: true });
}

async function copyCommon(destination) {
  for (const name of ["skills", "hooks", "runtime", "schemas", "templates", "legacy"]) {
    await fs.cp(path.join(ROOT, "src", name), path.join(destination, name), {
      recursive: true,
      force: true,
    });
  }
}

async function buildHost(host, manifestDirectory) {
  const destination = path.join(STAGING, host);
  await fs.mkdir(path.join(destination, manifestDirectory), { recursive: true });
  await copyCommon(destination);
  await fs.copyFile(
    path.join(ROOT, "platform", host, "plugin.json"),
    path.join(destination, manifestDirectory, "plugin.json"),
  );
}

async function recover() {
  const previousExists = await fs.stat(PREVIOUS).then(() => true, () => false);
  const packagesExist = await fs.stat(PACKAGES).then(() => true, () => false);
  if (previousExists && !packagesExist) await fs.rename(PREVIOUS, PACKAGES);
  await fs.rm(STAGING, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await recover();
    await releaseLock();
    process.exit(1);
  });
}

try {
  await acquireLock();
  await fs.rm(STAGING, { recursive: true, force: true });
  await fs.rm(PREVIOUS, { recursive: true, force: true });
  await fs.mkdir(STAGING, { recursive: true });
  await buildHost("codex", ".codex-plugin");
  await buildHost("claude", ".claude-plugin");
  const exists = await fs.stat(PACKAGES).then(() => true, () => false);
  if (exists) await fs.rename(PACKAGES, PREVIOUS);
  await fs.rename(STAGING, PACKAGES);
  await fs.rm(PREVIOUS, { recursive: true, force: true });
  console.log("Built packages/codex and packages/claude from src.");
} catch (error) {
  await recover();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await releaseLock();
}
