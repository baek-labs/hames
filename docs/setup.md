# Setup and reconfiguration

First-use setup asks about the selected root, workspace names and paths, purposes, child folder roles and file rules. Existing choices are reused. There is no fixed workspace list. A workspace registration is confirmed by the user before files change.

Preview includes every proposed directory, configuration file, entry block and index write. Approve the preview once; apply checks its exact hash and detects stale files. Repeating a valid setup is read-only. Reconfiguration previews changed choices and never moves the original documents automatically.

Non-Git roots work normally and default to untracked task contracts. Setup does not initialize `.git`, commit, switch branches or push. Existing Git roots may choose whether task contracts are tracked.

The agent prepares a decisions JSON object or array; users do not need to write JSON. `runtime/setup.js plan --root <root> --input <file>` produces the preview. `apply` takes the same arguments plus `--approved --plan-hash <hash>`. Before approval, stage input in host temporary storage outside the user's project. No secret values belong in decisions.

Workspace fields: `id`, root-relative `path`, `name`, `purpose`, `folders`, `rules`, `exclude`, `context`, `protect`. Each folder has a workspace-relative path and purpose. Shared document records have a `docs/` path, purpose, scope (`common` or a workspace id) and optional dependencies. See [indexing](indexing.md) for rule fields.

## Existing configurations

A version 1 configuration is upgraded only through a preview. Archived contracts remain in place; active old contracts must finish or be explicitly handed off before upgrading. Damaged or interrupted settings do not silently fall back to defaults. The recovery preview is bound to a recovery hash and restores only this setup's changes; newer user edits are preserved.

## Legacy transition

Checked-in legacy manifests recognize unchanged files from the previously distributed public folder in the same folder. Secret and protected names are classified before reading content or computing hashes. Modified system files and unknown user files are preserved. Only exact unchanged system files listed in the approved transition may be removed. Existing workspaces stay in place; ambiguous registrations remain unresolved until confirmed.

This transition does not modify `.git`, history, remotes, branches, or the Git index. It validates the new configuration before cleanup and preserves interrupted recovery evidence.
