# Project setup and legacy transition

`/setup` runs after the Hames plugin is installed. It first performs a read-only inspection, then shows an exact plan. No project file is changed until the user approves that plan hash.

## New and existing projects

For an ordinary project, Hames proposes `.hames/config.yaml`, workspace registrations, durable context, contract directories, Git exclusions, and bounded entry blocks for `AGENTS.md` and `CLAUDE.md`. Existing project-owned content is preserved. A changed file or setup choice produces a different plan hash and requires a new preview.

Workspace IDs and paths are user-defined. Hames can register several workspaces, but every relative path must stay inside the project and every registration name must be explicit.

## Previously distributed Hames folders

Hames can recognize a public legacy Hames distribution from the supported `baek-labs/hames` main history. The checked-in legacy manifests cover the first public commit through the last commit before this redesign. Each manifest records supported commits, system-file paths and original SHA-256 values, kinds, protected status, and multiple detection signatures.

A full official Git clone uses the nearest supported ancestor. A shallow clone or history-free copy must match the kernel marker and several independent file signatures. A folder name or one matching file is never enough.

The transition happens in the same folder:

1. Classify secret and credential paths before any content inspection.
2. Identify original system files, modified system files, user files, submodules, and unknown items.
3. Propose workspace candidates from entry files and project structure.
4. Wait for confirmation of any ambiguous workspace path or registration name.
5. Show cleanup, preservation, setup, and workspace decisions in one canonical plan hash.
6. Create and validate the new `.hames/` configuration and entry instructions.
7. Remove only files that still match the selected manifest exactly.
8. Run read-only diagnosis and report every preserved item.

Hames does not move or copy a workspace. Modified system files, user files, unknown files, protected files, and changed or unverifiable submodules remain in place. A fork or partial copy receives only the classifications supported by evidence; ambiguous items remain pending.

## Secret-first boundary

Secret-name rules run before manifest matching, hashing, workspace discovery, or symlink inspection. Protected items appear in a preview only by relative path, kind, and existence. Their content, size, digest, and link target are never read into the plan or event record.

## Git and recovery

The transition does not change `.git`, commit history, the index, branches, tags, or remote configuration. It may remove an unchanged tracked system file from the working directory only after approval; Git then shows that working-tree change for the user to review.

Apply recalculates all approved inputs immediately before writing. If any cleanup file, entry document, workspace decision, preservation classification, or setup choice changed, Hames stops and requires a new preview. During execution it keeps only a temporary recovery record for this run. On a handled failure, newly created setup files are rolled back and removed public system files are restored; no long-lived backup branch, tag, or copy is created.
