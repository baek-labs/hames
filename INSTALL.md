# Installing Hames

> This document is **dual-use**: a human can read it as a quickstart, and an AI client (Claude Code, Codex, Gemini CLI) can follow it as a step-by-step SOP.
>
> If you are an AI client invoked with this repository as input, treat each numbered step as a tool call. Stop and report at the first failure.

---

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Node.js | 18+ | Hooks and Arsenal scripts |
| Python | 3.10+ | Some Arsenal tools |
| Git | 2.30+ | Clone, hooks |
| One AI client | — | Claude Code, Codex CLI, or Gemini CLI |

Optional: **GitHub Codespaces** — `.devcontainer/` configures everything automatically when you "Open in Codespaces".

---

## Quickstart (5 minutes)

### Windows (PowerShell)

```powershell
git clone https://github.com/baek-labs/hames.git
cd hames
powershell -ExecutionPolicy Bypass -File scripts/init.ps1
```

### macOS / Linux (bash)

```bash
git clone https://github.com/baek-labs/hames.git
cd hames
bash scripts/init.sh
```

The installer prompts for your name and (optional) email, renders framework tokens, generates per-machine state, and runs verification.

If verification passes, you're done.

After rendering, the installer marks personalized framework files as local-only in Git. This keeps `git status` clean for normal users even though files now contain your local path and name.

---

## SOP — Step-by-Step (for AI clients)

> Each step has a **goal**, a **command**, and a **success check**. Do not proceed to the next step until the success check passes.

### Step 1 — Confirm clone location

**Goal:** Operate from the Hames root directory.

**Command:**
```bash
pwd
ls CLAUDE.md AGENTS.md scripts/
```

**Success check:** All three paths exist and you are in the repo root.

### Step 2 — Detect platform

**Goal:** Pick the right installer.

**Logic:**
- If `$OSTYPE` matches `msys|cygwin|win32` OR `Get-CimInstance Win32_OperatingSystem` succeeds → Windows
- Otherwise → POSIX (macOS/Linux)

### Step 3 — Run the installer

**Goal:** Render framework tokens, create per-machine state.

**Command (Windows):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/init.ps1 -CeoName "<your-name>" -CeoEmail "<your-email>" -NonInteractive
```

**Command (POSIX):**
```bash
CEO_NAME="<your-name>" CEO_EMAIL="<your-email>" NON_INTERACTIVE=1 bash scripts/init.sh
```

**Success check:** Installer prints `Hames install complete.` and exits 0.

### Step 4 — Verify

**Goal:** Confirm install correctness independent of the installer's own claims.

**Command:**
```bash
node scripts/verify_install.js
```

**Success check:** Exit 0 with `failed: 0` line in output.

If `failed > 0`: read the failure list. Most common causes:
- Hooks not executable on POSIX → `chmod +x .claude/hooks/*.js arsenal/*.js`
- JSON parse errors → indicates a file was edited by hand and broken
- Unrendered tokens → re-run `init.{ps1|sh}` (idempotent)

### Step 5 — (Optional) Add API keys

**Goal:** Enable Arsenal tools that depend on external APIs.

**Action:** Edit `arsenal/.env` (already created from `.env.example`). Each variable is a separate Arsenal tool. Skip any you don't plan to use.

### Step 6 — Confirm AI client integration

**Goal:** First substantive prompt should activate defense lines.

**For Claude Code:** Open the directory in Claude Code, type any first message. Hames prepends the kernel automatically (per `CLAUDE.md` `@import` directives). The first response will include the **Loaded** and **Signatures** lines (defense line 2).

**For Codex CLI / App:** Run `codex` in this directory. Hames loads via `AGENTS.md`.

**For Gemini CLI:** Add `~/.gemini/GEMINI.md` redirect (see `docs/05_harness.md` Gemini section), or run from this directory.

**Success check:** First substantive response from your AI client contains both lines:
```
Loaded: CLAUDE.md, prompt_engineering.md, context_engineering.md, agent_engineering.md, harness_engineering.md, arsenal/CLAUDE.md
Signatures: HAMES SYSTEM KERNEL v5.5 | DEEP_TASK_PROTOCOL | FIXED LOAD ORDER | COO ROUTER | DEFINED_CRITICAL_ACTIONS | HAMES ARSENAL — 툴 레지스트리
```

### Step 7 — Try `/doctor`

**Goal:** End-to-end smoke test.

**Action:** In your AI client, type `/doctor`.

**Success check:** Output reports system integrity. Any RED items are configuration issues; YELLOW are typically optional integrations not yet configured.

---

## Troubleshooting

### "Token still shows as `{{HAMES_ROOT}}`"

The installer didn't reach that file. Re-run:
```bash
bash scripts/init.sh   # or .ps1 on Windows
```
Init is idempotent.

### "I want to edit Hames framework files after install"

Init marks rendered framework files as local-only so casual users do not see noisy Git changes. If you are developing the framework itself, clear that local-only flag first:

```bash
git ls-files -v | grep '^S' | cut -c3- | xargs git update-index --no-skip-worktree
```

PowerShell:

```powershell
git ls-files -v | Where-Object { $_ -like 'S *' } | ForEach-Object { git update-index --no-skip-worktree -- $_.Substring(2) }
```

### "compliance_auditor.js blocks every Bash"

Defense line 3 is checking your first response for the **Signatures** line and not finding it. This is intended — the harness is doing its job.

If you trust the AI client's load order, ask the AI to output the Signatures line manually first. The hook accepts the line anywhere in the first substantive response.

Emergency override (use sparingly):
```bash
touch .claude/.context_verifier_disabled
```

### "Cannot find module 'X' when running a hook"

Run `npm install` inside `arsenal/`:
```bash
cd arsenal && npm install
```

### "Hooks fail on macOS/Linux: Permission denied"

```bash
chmod +x .claude/hooks/*.js arsenal/*.js arsenal/*.sh
```

The installer attempts this automatically; some filesystems may not preserve the bit.

---

## Uninstall / Reset

Hames keeps no state outside the cloned directory. Delete the directory.

To reset just the per-machine state (lock, paths) without re-cloning:
```bash
rm .claude/.workspace_lock .claude/workspace_paths.json
bash scripts/init.sh
```

---

## What's Next

| You want to... | Read |
|---|---|
| Understand the philosophy | `docs/01_philosophy.md` |
| Use workspaces | `docs/04_workspace_model.md` |
| Build your own slash command | `docs/02_kernel.md` |
| Add an isolated domain | `docs/04_workspace_model.md` (advanced section) |
| Debug a hook | `docs/05_harness.md` |
| Build your own agent team | `docs/06_agent_architecture.md` |

---

## Status

This repository is a **frozen reference implementation** — version `v1.0`. Issues and PRs are not actively monitored. Fork freely (MIT License).
