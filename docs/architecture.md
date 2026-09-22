# Architecture

`src/` owns shared skills, runtime, hooks, schemas, templates, legacy transition evidence and integration provenance. `scripts/build.mjs` generates `packages/codex` and `packages/claude` from this tree plus `platform/` manifests. No network fetch happens at installation or runtime.

## Responsibilities

- Setup turns user choices into a hash-bound preview of folders, settings, entry blocks and indexes. Apply verifies the same preview, journals progress and preserves newer user edits during recovery.
- Workspace configuration owns folder roles, file rules and exclusions. The runtime uses root-relative paths for workspaces/documents and workspace-relative paths for child folders and rules.
- Indexing reads actual disk state. Managed index blocks are derived navigation; manual prose remains user-owned. A post-tool hook updates affected folders. Auditing never writes.
- Context loading reads root navigation, common documents, the selected workspace and its scoped documents. Explicit document dependencies are followed once. Missing or size-limited reads remain visible.
- Ready/go use one `.hames/contracts/` store. Specification, work order, handoff, evidence and durable-knowledge destinations belong to one task; shared `docs/` belongs to the workspace lifetime.

## Source map

| Path | Responsibility |
|---|---|
| `src/skills/{setup,ready,go,index,doctor}` | User-facing workflows |
| `src/runtime/setup.js`, `legacy.js` | Preview/apply/recovery and old-layout transition |
| `src/runtime/config.js`, `workspace.js` | Parsing, validation, ownership and path boundaries |
| `src/runtime/index.js`, `rules.js` | Inventory, index changes, audit and rules |
| `src/runtime/context.js` | Scoped reading and session workspace selection |
| `src/runtime/contract.js`, `doctor.js` | Task lifecycle and diagnostics |
| `src/hooks/` | First-use context, pre-write checks, evidence, automatic indexes |
| `src/integrations/dryforge/` | Pinned original material, checksums and license |
| `tests/` | Behavior, failure recovery, contracts and distribution tests |

Settings use schema version 2; version 1 remains readable for explicit migration. User-selected workspace ids survive display-name changes. The most specific registered path owns a nested workspace. A configuration with conflicting ownership is invalid.

The task lifecycle remains `DRAFT → READY → ACTIVE → REVIEW → ACCEPTED → ARCHIVED`. Same-session go approves only the exact presented revision. Changed specifications invalidate approval; another session needs explicit selection or handoff. Index locks serialize maintenance writes; deferred work stays visible to doctor.
