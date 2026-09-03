---
name: setup
description: Configure or diagnose Hames in the current project when the user invokes /setup.
---

# Setup

Inspect the current project and use the bundled setup runtime. Show every proposed file change and wait for explicit approval before applying it.

Do not copy plugin skills into the project. Ask whether contracts should be Git-tracked; never infer that choice.

Preserve existing `AGENTS.md` and `CLAUDE.md`; propose only the bounded Hames block. A valid repeated setup is read-only.

If config is damaged or interrupted recovery state exists, report the error and recovery choices instead of guessing or writing.

The preview returns a `plan_hash`. Pass that exact value to apply as `--plan-hash`; if the project changed and the hash differs, stop and show a new preview for approval. Recovery also requires a read-only recovery preview, its exact `recovery_hash`, and a separate explicit approval before rollback.

When the bundled legacy manifests identify a previously distributed public Hames tree, present a same-folder transition plan instead of a generic setup. Classify protected names before reading or hashing anything, and show protected items only by relative path, kind, and existence. Never expose content, size, digest, or symlink target for those items.

Propose workspace candidates from project evidence rather than folder names. Register a path in place only when both the path and registration name are confirmed by an existing Hames mapping or the user; leave ambiguous folders preserved and pending. Do not move or copy workspaces.

Only remove files whose current digest and kind still match the selected public manifest. Preserve modified system files, user files, unknown files, protected files, and submodules. Do not change `.git`, history, index, branches, tags, or remote settings. Apply the new configuration and validate it before cleanup; on any failure, restore only changes made by this transition.
