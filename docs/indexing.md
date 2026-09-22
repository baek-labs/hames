# Indexes and file rules

Each managed folder has `_Index.md` with direct files and child-folder index links. The root maps workspaces and shared docs. Generated rows contain a path, display name, purpose and scope. File bodies are not exhaustively summarized; unknown purposes remain explicit.

Only the block between `HAMES:INDEX:START` and `HAMES:INDEX:END` is maintained. Manual text and existing links remain. Manual links already covering a target are not duplicated. Broken manual links are reported rather than rewritten. Generated links are encoded relative Markdown links; readable wiki links are recognized. Symlinks are not traversed.

Default exclusions: `.git`, `.hames`, `node_modules`, `.cache`, `.next`, `dist`, `build`, `coverage`, `.DS_Store`, `.env` files, private-key/certificate extensions and Hames temporary writes. Additional exclusions are explicit root or workspace-relative paths. The audit reports excluded scope. User content is not excluded merely for being old.

## Rules

Each rule has a unique `id`, workspace-relative folder `path` (default `.`), `kind`, and `value`.

| Kind | Value | Check |
|---|---|---|
| `extension` | Nonempty list such as `[".md"]` | Allowed extension under that folder |
| `name` | Regular expression string | File basename |
| `required` | Required text | Supported text-file content, at most 1 MiB by default |
| `semantic` | Natural-language requirement | Requires content judgment; never a mechanical pass |

Folder purpose and ownership supply context. Nested workspace ownership takes precedence. Shared `docs/` has system-document scope and does not inherit a report workspace's naming rules. Unregistered shared documents need purpose/scope classification.

## Automatic maintenance and audits

Supported Write/Edit/MultiEdit/NotebookEdit/apply_patch success events recheck actual files and update affected indexes. A patch move updates both locations; reads, failed tools and index self-edits do not recurse. Shell and external application changes are found by a later audit, not a filesystem watcher.

`runtime/index.js audit --root <root> [--target <id-or-path>]` is read-only. Findings distinguish `violation`, `needs_judgment`, `unverifiable`, and explicit exclusions. A report with unresolved items is not fully healthy.

A requested repair uses `plan`, then `apply --approved --plan-hash <hash>`. Changes after preview require another preview. Repairs only write index blocks. They do not move or delete source files.

Writes use a root-local lock, atomic replacement, before-content checks and a deferred queue. If another writer is active, a bounded retry is followed by an explicit queued result. A failed index write preserves the source file. Do not remove an index lock until its owner is verified inactive and the user chooses recovery. Missing registered directories are reported, not silently recreated. Rerun approved index maintenance after recovery.
