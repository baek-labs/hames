# Hames repository guidance

This repository builds the Hames plugin for Codex and Claude Code.

- `src/` is the only human-edited source of truth for skills, hooks, runtime code, schemas, and templates.
- `packages/codex` and `packages/claude` are generated. Do not edit them directly; run `node scripts/build.mjs`.
- Core provides `/setup`, `/ready`, `/go`, `/index`, and `/doctor`. Preserve the same-session present-to-go approval contract, dependency-aware progress, proportional independent review, and approved durable-knowledge destinations. Optional packs belong behind documented extension points.
- Use project-relative paths and provider-neutral contract semantics. Do not add a fixed user, workspace list, role team, host path, or personal integration.
- Write a failing test before risky behavior changes. Run `node --test`, `node scripts/build.mjs`, `node scripts/verify.mjs`, and `git diff --check` before handoff.
- Do not commit, push, release, publish, or submit a marketplace listing unless the user explicitly requests it.

Hames includes adapted DryForge intent and execution workflows. Ordinary work requires no Git, and Git mutations require an explicit user request. Workspace roles are user-defined; long-lived docs are shared at the chosen root and loaded selectively. Index auditing is read-only; observed file changes update managed index blocks.
