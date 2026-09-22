# Hames

Hames is an AI workspace harness shaped by its user. Install one plugin, choose your folders and rules in a first-use conversation, and let your agent keep work in the right place with maintained file indexes.

It works with code, documents, browser work, and external service tasks. Ordinary file work needs no Git and no task contract. Larger tasks can use the included intent-to-execution workflow adapted from DryForge.

## First use

1. Install the Hames plugin for Codex or Claude Code and review its hooks.
2. Open the folder you want to use as your AI work root. In a fresh session, Hames invites setup when its startup hook is available; otherwise invoke `/setup`.
3. Describe the workspaces you want. Choose folder names, purposes, subfolder roles, file rules, and existing folders to preserve. Examples are editable, never fixed categories.
4. Review the complete folder and file-change preview, then approve it once.
5. Work normally. Supported file-tool writes update the affected indexes. Use `/index` to inspect inventory and rules.

Installing a plugin does not itself configure a folder or prove hook trust and execution. See [host support](docs/host-support.md).

## Install

### Codex

```sh
codex plugin marketplace add baek-labs/hames --ref main
codex plugin add hames@baek-labs
```

Open a new session after installation and review the bundled hooks in the host.

### Claude Code

```text
/plugin marketplace add baek-labs/hames
/plugin install hames@baek-labs
```

Start a new Claude Code session. The repository's generated packages are the installable source; publication of local changes is a separate action.

## Commands

| Command | What it does |
|---|---|
| `/setup` | Ask about your workspace, preview changes, apply your choices, or reconfigure them. |
| `/ready` | Resolve open decisions and present one bounded task contract. |
| `/go` | Approve the contract just shown, execute, verify, and present the result for acceptance. |
| `/index` | Read-only audit of indexes, placement, names, and configured document rules. |
| `/doctor` | Read-only diagnosis of configuration, recovery state, package wiring, and hook observations. |

Hosts may display these with a Hames namespace. Use the discovered command names. Index repairs are previewed and run only when requested; an audit never moves or deletes documents.

## Your workspace

```text
your-root/
├── AGENTS.md / CLAUDE.md
├── _Index.md
├── .hames/                 # settings, workspace roles, contracts and local state
├── docs/                   # shared long-lived operating documents
│   └── _Index.md
└── <your chosen folders>/
    └── _Index.md
```

Hames reads common rules, the current workspace index, and relevant shared documents. It does not load every document by default or copy a full documentation set into each folder. Existing user text is preserved in entry files and indexes. Repeated setup with the same choices makes no changes.

The built-in DryForge-derived workflow is adapted for shared documents, selective loading, one contract store, and Git only on explicit request. It is not the unmodified upstream plugin. [Integration and attribution](docs/dryforge-integration.md).

## Verification boundaries

Structured file-tool events support automatic indexing. Shell commands, external applications, and sync tools may require `/index` to discover changes; there is no background watcher. Semantic classification is reported separately from mechanical rule violations. Unreadable or unsupported items are never counted as fully verified.

Paths cannot escape the configured root through `..` or symlinks. Shell and unstructured UI inspection is best-effort. Deleting, sending, publishing, deploying, paying, and changing permissions require authorization for that action. [Safety](docs/safety.md).

## Development

`src/` is the source of truth. Do not edit generated `packages/` by hand.

```sh
node --test
node scripts/build.mjs
node scripts/verify.mjs
git diff --check
```

See [architecture](docs/architecture.md), [setup](docs/setup.md), [indexing](docs/indexing.md), [development](docs/development.md), and [verification evidence](docs/verification.md).

## License

MIT for Hames. Adapted DryForge materials retain their original MIT copyright notice in `src/integrations/dryforge/LICENSE` and both generated packages.
