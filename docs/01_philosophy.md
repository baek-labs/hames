# Philosophy

> **TL;DR** — Hames is a strategic operating system for AI engineers who run a personal stack of agents across multiple models. It exists because production-grade AI work needs the same workspace discipline that production-grade software work needs: clear boundaries, deterministic guardrails, and routing decisions that survive context switches.

This document explains the *why* behind Hames. Read it once before reading the rest. The other documents are reference material; this one is orientation.

---

## The problem space

A typical AI engineer in 2026 has roughly the following surface area:

- **Multiple model clients** — Claude Code, Codex CLI, Gemini CLI, and at least one hosted SDK
- **Several work domains** — day-job projects, side projects, research, content
- **External integrations** — Notion, GitHub, search APIs, document tooling
- **Personal automations** — scheduled jobs, reports, agent loops

Each model client has its own configuration surface (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`). Each domain has its own conventions. Without a coordinating layer, three failure modes appear:

1. **Drift.** Rules defined for one client diverge from rules in another. The same prompt yields different behavior on Claude vs Codex.
2. **Leakage.** Work from one domain ends up in the wrong directory tree, with the wrong metadata, or — worst — committed to the wrong repo.
3. **Erosion.** Safety rules ("don't overwrite without confirmation", "validate frontmatter") slowly stop being enforced because nobody re-reads the prompt that defined them.

Hames addresses these three failure modes directly.

---

## The four design principles

### 1. Workspace-first execution

Every substantive task happens **inside a workspace**, not at the repository root. A workspace defines:

- output destination
- file naming convention
- metadata schema
- local context priorities

The workspace is determined first. The agent team is determined second. This is reversed from how most agent frameworks operate — they start from "which agent" and the workspace becomes whatever the agent decides to write into. Hames inverts that.

**Why this matters for AI engineers:** when an agent writes a file, the workspace determines whether that write is correct *before* the agent runs. A wrong-workspace write is caught at the harness layer, not after the fact.

### 2. Defense lines, not exhortations

Most prompt-engineering systems try to make the model behave correctly by instructing it. Hames does this too — but it does not *trust* the instruction. Each load-bearing rule is backed by a hook script that the model cannot bypass.

The system has four defense lines:

| # | Layer | Mechanism |
|---|---|---|
| 1 | Text | Six core rule files must be loaded before substantive work |
| 2 | Text | Confirmation block must appear in the first response |
| 3 | Infrastructure | PreToolUse hook reads the transcript and blocks tool calls if defense line 2 is missing |
| 4 | Infrastructure | Wrapper script pre-injects rule content into headless model invocations |

See `docs/03_defense_lines.md` for the full mechanics.

### 3. Routing through a router, not through agents

The COO ("Chief Operating Officer") agent is the **router**, not the executor. Tasks flow:

```
Task → COO (router) → Workspace → Level-1 agent → Level-2 sub-team → Execute → Harness
```

The COO does not write the file. The COO decides *which workspace* and *which agent team*, then hands off. This separation matters because:

- Routing decisions are explicit and auditable
- Sub-teams stay specialized (one team for finance, one for content, one for code)
- Adding a new domain doesn't require teaching the executor a new role

### 4. Frozen reference, not framework

This repository is intentionally *not* a framework. There are no plugins, no extension points designed for external contribution. It is a reference implementation, complete and frozen at v1.0.

**Why this design choice matters:** a frozen reference does not break. You can fork it, modify it for your needs, and never worry about an upstream change forcing migration. The cost is that you carry your fork forward yourself. For a personal AI stack, that's the right trade.

---

## Rational Materialism

The system's core philosophy is **Rational Materialism & Excellence**:

- **Rational** — every rule has an articulated reason. If a rule's *why* erodes, the rule is removed.
- **Material** — every rule is enforced by something concrete (a hook, a script, a verifier). Pure exhortation does not survive.
- **Excellence** — the bar is "production-grade for one operator", not "good enough for casual use".

This is not a casual-tinkering tool. It is shaped for someone who runs serious work through their AI stack and treats that stack as load-bearing infrastructure.

---

## What Hames is *not*

- Not a model. Hames runs on top of Claude / Codex / Gemini; it does not include or train any model.
- Not a hosted service. Everything runs locally (or in your Codespace).
- Not a chatbot framework. It is a discipline layer for personal AI work.
- Not opinionated about your domain. It assumes you have one or several; it does not assume which.
- Not optimized for teams. Multi-user collaboration is out of scope. (See FAQ below.)

---

## Who is this for

| You are... | Hames is... |
|---|---|
| An AI engineer with multiple model clients | The right shape |
| A solo operator running a personal stack | The right shape |
| Someone who likes high-leverage personal tools | The right shape |
| A team of 3+ collaborating on shared workspaces | Probably wrong shape — the workspace lock model assumes one operator |
| Someone who wants out-of-the-box agents with no setup | Probably wrong shape — Hames is opinionated and expects investment |

---

## FAQ

### Why is `Hames` the system name?

The original operator's name read in Latin pronunciation produced "Hames". Coincidentally, *hames* is also the English word for the curved metal pieces that fit around a horse's collar to which the harness is attached. Given that this system *is* a harness, the name stuck.

### Why six core rule files instead of one big file?

Modularity. Each module covers one concern (prompt, context, agent, harness, enforcement). When something needs to change, the diff is in one module. The kernel `CLAUDE.md` is a thin entry point that imports the modules.

### Why not just write better prompts?

Better prompts erode under model updates and context pressure. Hooks don't.

### Why frozen at v1.0?

Maintaining a public framework is its own engineering job. The author chose not to take that on. Forking is the supported extension model.

### Where do I start?

Read `docs/02_kernel.md` next.
