# hames

> **Workspace-first orchestration for multi-model AI workflows.**

A strategic operating system for AI engineers running a personal stack of agents across Claude Code, Codex, and Gemini CLI. Production-grade safety guarantees backed by hooks, not exhortations.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-frozen%20reference-blue)](#status)
[![Version](https://img.shields.io/badge/version-v1.0-green)](https://github.com/baek-labs/hames/releases)

> **Hames is workspace-first, not agent-first.** Its primary unit is the workspace, not the tool call. This separates Hames from typical agent harnesses, which center on tool execution.
>
> ⚠️ **This is a starting template, not a finished product.** The default workspaces, agent roles, and slash commands are intentional examples — fork and replace them with your own domain.

---

## 🚀 The Lazy Way (let your AI set it up)

Open Claude Code, Codex CLI, or Gemini CLI in any directory and paste:

> Set up Hames for me. Read [`SETUP_PROMPT.md`](https://raw.githubusercontent.com/baek-labs/hames/main/SETUP_PROMPT.md) and follow it step by step. Stop and ask me if anything fails.

Your AI will: clone the repo, run the platform-appropriate installer, render personalization tokens, run the 30-assertion verifier, and tell you when it's done. Total: ~3 minutes of mostly-watching.

If you'd rather drive manually, see the [Quickstart](#quickstart) section below.

---

## Why

A typical AI engineer in 2026 runs three model clients, several work domains, and a dozen integrations. Without a coordinating layer:

- Rules drift across clients
- Work leaks across domains
- Safety conventions erode under context pressure

Hames addresses these directly with **workspace-first execution**, **defense lines backed by hooks**, and **a router-not-executor agent architecture**.

---

## Quickstart

### Windows
```powershell
git clone https://github.com/baek-labs/hames.git
cd hames
powershell -ExecutionPolicy Bypass -File scripts/init.ps1
```

### macOS / Linux
```bash
git clone https://github.com/baek-labs/hames.git
cd hames
bash scripts/init.sh
```

### GitHub Codespaces

Click **"Open in Codespaces"**. The `.devcontainer/` configuration installs Claude / Codex / Gemini CLIs and runs setup automatically.

See [`INSTALL.md`](INSTALL.md) for the full SOP, troubleshooting, and AI-client integration steps.

The installer personalizes a few framework files with your local path and operator name, then marks those rendered files as local-only so `git status` stays clean. If you later fork Hames to develop the framework itself, see the reset notes in [`INSTALL.md`](INSTALL.md).

---

## What you get

- **Six core rule modules** — kernel, prompt, context, agent, harness, enforcement. Loaded automatically across Claude Code, Codex, Cursor, and Gemini CLI.
- **Four defense lines** — text-level instruction → first-response confirmation → PreToolUse hook → wrapper-script pre-injection.
- **Workspace-first routing** — execution flows `Task → COO → Workspace → Agent → Harness`, not the other way around.
- **Two-tier agent architecture** — five Level-1 domain agents (CFO, CSO, CBO, CTO, Marketer) each with specialized Level-2 sub-teams (analyst → planner, writer → auditor, architect → coder → reviewer, etc.).
- **AI_COMM** — model-to-model handoff buffer for Claude ↔ Codex ↔ Gemini continuity.
- **Hook-enforced safety** — overwrite blocking, surgical-edit enforcement, workspace lock, frontmatter validation, dangerous-Bash gating.

---

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/01_philosophy.md`](docs/01_philosophy.md) | Why Hames exists, design principles, who it's for |
| [`docs/02_kernel.md`](docs/02_kernel.md) | Kernel anatomy, the five rule modules, fork-safe sections |
| [`docs/03_defense_lines.md`](docs/03_defense_lines.md) | Threat model and the four-layer enforcement system |
| [`docs/04_workspace_model.md`](docs/04_workspace_model.md) | Workspaces, frontmatter, isolated-domain pattern |
| [`docs/05_harness.md`](docs/05_harness.md) | Every hook, when it fires, when to bypass |
| [`docs/06_agent_architecture.md`](docs/06_agent_architecture.md) | COO routing, Level-1/2 spawn protocol, AI_COMM |
| [`docs/glossary.md`](docs/glossary.md) | Term definitions |

---

## Status

**Frozen reference implementation, v1.0.** Issues and PRs are not actively monitored. Fork freely (MIT License).

This is intentional. Maintaining a public framework is its own engineering job; the author chose not to take that on. The system is complete as shipped. Extend by forking.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Acknowledgements

Built on top of (and grateful to) Claude Code, Codex CLI, Gemini CLI, Cursor, and the broader AI engineering community whose conventions Hames operationalizes.

The `hames-local` plugin includes a Hames-aware fork of upstream Claude Code plugins. See [arsenal/plugins/hames-local/](arsenal/plugins/hames-local/) for upstream attribution.
