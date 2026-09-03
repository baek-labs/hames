# Hames plugin development

`src/` is the source of truth. The `packages/codex` and `packages/claude` trees are generated distribution outputs; rebuild them with `node scripts/build.mjs` and never maintain host copies by hand.

The Core product surface is exactly `/setup`, `/ready`, `/go`, and `/doctor`. Preserve existing project entry files during setup, require exact contract approval before activation, request a separate confirmation for critical actions, and store only safe evidence metadata.

All project locations are relative to the configured project root. File hooks must reject lexical and symlink escape, while descriptions must state that shell and unstructured UI enforcement is best-effort.

For changes, add or update tests first, then run:

```sh
node --test
node scripts/build.mjs
node scripts/verify.mjs
git diff --check
```

Do not commit, push, release, publish, or submit a marketplace listing without an explicit request.
