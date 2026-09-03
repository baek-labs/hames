# Hames repository guidance

This repository builds the Hames plugin for Codex and Claude Code.

- `src/` is the only human-edited source of truth for skills, hooks, runtime code, schemas, and templates.
- `packages/codex` and `packages/claude` are generated. Do not edit them directly; run `node scripts/build.mjs`.
- Keep Core limited to `/setup`, `/ready`, `/go`, and `/doctor`. Optional packs belong behind documented extension points.
- Use project-relative paths and provider-neutral contract semantics. Do not add a fixed user, workspace list, role team, host path, or personal integration.
- Write a failing test before risky behavior changes. Run `node --test`, `node scripts/build.mjs`, `node scripts/verify.mjs`, and `git diff --check` before handoff.
- Do not commit, push, release, publish, or submit a marketplace listing unless the user explicitly requests it.
