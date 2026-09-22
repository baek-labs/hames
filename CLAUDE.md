# Hames plugin development

`src/` is the source of truth. The `packages/codex` and `packages/claude` trees are generated distribution outputs; rebuild them with `node scripts/build.mjs` and never maintain host copies by hand.

The Core product surface is `/setup`, `/ready`, `/go`, `/index`, and `/doctor`. Preserve existing project entry files during setup. A same-session `/go` approves and activates only the exact contract just presented; critical actions still require separate confirmation. Store only safe evidence metadata.

All project locations are relative to the configured project root. File hooks must reject lexical and symlink escape, while descriptions must state that shell and unstructured UI enforcement is best-effort.

For changes, add or update tests first, then run:

```sh
node --test
node scripts/build.mjs
node scripts/verify.mjs
git diff --check
```

Do not commit, push, release, publish, or submit a marketplace listing without an explicit request.

Hames includes adapted DryForge intent and execution workflows. Ordinary work requires no Git, and Git mutations require an explicit user request. Workspace roles are user-defined; long-lived docs are shared at the chosen root and loaded selectively. Index auditing is read-only; observed file changes update managed index blocks.
