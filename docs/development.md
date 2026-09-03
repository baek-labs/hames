# Development

The `src/` tree is the human-edited source of truth. `packages/codex` and `packages/claude` are generated artifacts and must not be edited directly.

## Workflow

For risky behavior, add a failing test before implementation. Then run:

```sh
node --test
node scripts/build.mjs
node scripts/verify.mjs
git diff --check
```

Run the build twice and compare the package tree when changing distribution logic. `scripts/verify.mjs` parses manifests and schemas, compares shared source files with both packages, and checks Core for prohibited fixed assumptions. CI runs it before rebuilding so stale committed packages fail, then rebuilds and requires `git diff --exit-code -- packages`.

## Reliability boundaries

- Data loss: setup previews exact changes, writes atomically, journals an in-progress apply, and rolls back completed operations on failure. Generated packages are recoverable from `src/`.
- Network failure: Core setup, contracts, guards, builds, and tests perform no network requests. External-operation retries belong to the integration performing that action and must be declared in its task contract.
- Process crash: setup leaves a recovery record for `/doctor`; builds stage new packages before replacement; contract and evidence JSON use same-directory atomic replacement. Mismatched state is diagnosed instead of silently discarded.

## Release check

Automated tests cover new and existing project setup, non-Git projects, idempotence, damaged configuration, rollback, lifecycle transitions, three task types, path and symlink escape, tampering, evidence gaps, package determinism, and documentation. A release additionally requires fresh-session discovery and representative flows in both supported hosts.
