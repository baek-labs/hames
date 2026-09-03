# Hames

Hames is a workspace-first, general-purpose harness for AI agents. It separates what a user approves from how an agent implements it, guards the approved boundary, and uses observable evidence to decide whether work is complete.

Hames handles code, documents, browser work, and external service operations through the same `setup → ready → go` flow.

## How it works

1. Install the Hames plugin for your agent host.
2. Open the target project and run `/setup`.
3. Review the proposed project files and approve the exact changes.
4. Run `/ready` to define and approve one task contract.
5. Run `/go <task-id>` to execute that contract.
6. Review the evidence and accept the result; Hames then archives the contract.

Installing the Hames plugin adds the skills and hooks to the host. `/setup` is a separate step that configures the current project. It does not copy skill files into the project.

## Install

### Codex

Add this repository as a marketplace source:

```sh
codex plugin marketplace add baek-labs/hames --ref main
```

Restart the Codex app, select the Baek Labs source in the Plugins Directory, and install Hames. Review and trust the bundled hooks before expecting them to run.

### Claude Code

Inside Claude Code:

```text
/plugin marketplace add baek-labs/hames
/plugin install hames@baek-labs
```

Restart Claude Code after installation so its skills and hooks are rediscovered.

Codex and Claude Code are the first supported hosts. Other hosts are not officially supported by this release; see [host support](docs/host-support.md).

## Core commands

| Command | Purpose |
|---|---|
| `/setup` | Preview, approve, apply, and diagnose project-level Hames configuration. |
| `/ready` | Turn user intent into a bounded, evidence-aware contract and obtain approval. |
| `/go` | Activate one approved contract, execute it, verify evidence, obtain acceptance, and archive it. |
| `/doctor` | Inspect plugin, project, contract, and session health without changing anything. |

`/ready` approval and `/go` do not authorize a critical action. Hames asks again immediately before deletion, sending, publication, deployment, payment, permission changes, or impactful external-service mutations.

## Project files

`/setup` proposes this project-owned structure:

```text
.hames/
├── config.yaml
├── workspaces/default.yaml
├── context/project.md
├── contracts/active/
├── contracts/archive/
└── state/
```

Existing `AGENTS.md` and `CLAUDE.md` files are preserved. Hames adds only a clearly marked boundary block after showing the diff and receiving approval. `.hames/state/` is always excluded from Git; tracking of `.hames/contracts/` is the user's choice.

If `/setup` recognizes a previously distributed public Hames folder, it offers a same-folder transition. Checked-in legacy manifests identify unchanged system files; modified, user-owned, protected, unknown, and submodule content stays in place. Workspace paths are never moved or inferred from folder names, and ambiguous registrations wait for confirmation. See [project setup and legacy transition](docs/setup.md).

## Safety boundary

The file guard rejects project escape through absolute paths, `..`, or symlinks and checks the active contract hash. Shell inspection is best-effort, and unstructured browser or UI work cannot be made safe by a path hook alone. External changes require observable pre-state, action, and post-state evidence unless the user approves a documented exception.

See [architecture](docs/architecture.md), [safety](docs/safety.md), [extensions](docs/extensions.md), and [development](docs/development.md).

## Scope

Hames Core provides only `/setup`, `/ready`, `/go`, and `/doctor`. It does not include fixed personas, fixed workspaces, personal service integrations, model handoff systems, or Git/content/team packs. Extension points are documented, but optional packs are not implemented in Core.

## Development

```sh
node --test
node scripts/build.mjs
node scripts/verify.mjs
```

Edit `src/`, not `packages/`. The generated `packages/codex` and `packages/claude` directories are committed distribution artifacts and must exactly match the source build.

## License

MIT. See [LICENSE](LICENSE).
