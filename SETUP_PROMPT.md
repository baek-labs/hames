# Hames Setup Prompt

> **For humans:** Copy everything below the line. Paste into Claude Code, Codex CLI, Gemini CLI, or any modern AI client with shell-execution capability. The AI will perform a clean install of Hames v1.0 and report back.
>
> Total time: ~3 minutes (mostly waiting for `npm install`).
> Required: Node.js 18+, Python 3.10+, Git 2.30+, internet access.

---

You are setting up **Hames v1.0** for the operator. Hames is a workspace-first orchestration framework for multi-model AI workflows. Source: `https://github.com/baek-labs/hames`.

Execute the following steps **in order**. Stop at the first failure and report:
- which step failed,
- the verbatim error message,
- what you tried.

Do **not** modify any of the operator's existing files outside the install target directory.

---

## Step 0 — Confirm location

Ask the operator where to install Hames. Default to a sibling directory of the current working directory called `hames/`.

Confirm with the operator before proceeding. Do not silently choose a path.

## Step 1 — Clone

```bash
git clone https://github.com/baek-labs/hames.git <target-dir>
cd <target-dir>
```

**Success check:** the directory contains `CLAUDE.md`, `AGENTS.md`, `scripts/`, `arsenal/`, `docs/`.

## Step 2 — Detect platform

- Windows (any of: `$OSTYPE` = `msys`/`cygwin`/`win32`, `Get-CimInstance Win32_OperatingSystem` succeeds, or `winver`-style indicators) → use `init.ps1`.
- Otherwise (macOS, Linux, WSL) → use `init.sh`.

## Step 3 — Collect personalization tokens

Ask the operator for two values:
- **Operator name** (becomes `{{CEO_NAME}}` in framework files; default: `Hames Operator`).
- **Operator email** (becomes `{{CEO_EMAIL}}`; optional, default: `operator@example.com`).

Do not invent values. Ask explicitly.

## Step 4 — Run the installer

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/init.ps1 -CeoName "<name>" -CeoEmail "<email>" -NonInteractive
```

**POSIX:**
```bash
CEO_NAME="<name>" CEO_EMAIL="<email>" NON_INTERACTIVE=1 bash scripts/init.sh
```

**Success check:** installer prints `Hames install complete.` and exits 0.

If the installer reports `npm dependencies skipped or failed`: this is non-fatal for the optional Arsenal tools. Continue.

## Step 5 — Verify

```bash
node scripts/verify_install.js
```

**Success check:** output contains `failed: 0` and the script exits 0.

If `failed > 0`: read the failure list, attempt the suggested remediation (e.g., `chmod +x .claude/hooks/*.js arsenal/*.js` on POSIX), re-run init, re-verify. If still failing, stop and report.

## Step 6 — Report

Tell the operator:

```
Hames v1.0 installed at: <path>

Try these next:
  1. Open this directory in your AI client (Claude Code / Codex / Gemini CLI).
  2. Type any first message — defense lines should activate (you'll see
     "Loaded:" and "Signatures:" lines in the response).
  3. Type /doctor — system integrity check.
  4. Read docs/01_philosophy.md to understand the design.
  5. When ready to start real work, copy workspaces/_scaffold to your
     own workspace name and fill in the template.

Documentation:
  - INSTALL.md       (full SOP, troubleshooting)
  - HamesSystem_Public.md  (narrative overview)
  - docs/01-06       (per-module technical reference)
  - docs/glossary.md (term definitions)

Status: frozen reference implementation. PRs not actively monitored. MIT License.
```

---

## Failure protocol

If any step fails:

1. **Do not improvise fixes** beyond what the script's own troubleshooting suggests.
2. **Do not delete the install directory** without explicit operator approval.
3. **Do not run `--force` flags** that weren't in the original commands above.
4. Report verbatim error + which step + what was attempted. Wait for operator direction.

## Bounds

- This prompt is for installation only. After install, the operator drives.
- You may answer `docs/`-level questions if the operator asks during install.
- You may **not** modify Hames framework files at install time (init handles all rendering).
- You may **not** install other packages or modify `~/.bashrc` / `~/.zshrc` / PowerShell profiles.

---

*This prompt is part of Hames v1.0. Source: https://github.com/baek-labs/hames/blob/main/SETUP_PROMPT.md*
