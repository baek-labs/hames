# Workspaces

Hames is **workspace-first**. Substantive work happens inside a workspace, not at the root.

## Adding your own workspace

1. Copy the scaffold:
   ```
   cp -r workspaces/_scaffold workspaces/MyDomain
   ```
2. Edit `workspaces/MyDomain/CLAUDE.md` — set the workspace identity, role, and frontmatter conventions.
3. Register the workspace path in `.claude/workspace_paths.json` (created by the install script).
4. Activate with `/lock MyDomain` to enforce write-isolation to that workspace.

## Default mental model

| Workspace | Typical role |
|---|---|
| `Investment` | financial analysis, asset management |
| `Business` | personal business, strategy, sales |
| `Company` | employer / day-job projects |
| `Hobby` | personal creative, learning, side projects |

These are starting suggestions, not requirements. Define your own taxonomy.

## Isolated domains (advanced)

If a domain needs its own agent team, hooks, and workflow guards, treat it as an **isolated domain** — a workspace with its own `.claude/agents/`, `.claude/hooks/<domain>_workflow_guard.js`, and trigger phrase. See `docs/04_workspace_model.md` for the full pattern.

## What does NOT belong in workspaces/

- Framework code → root or `arsenal/`
- Documentation → `docs/`
- Build artifacts → never commit (`.gitignore` blocks)

## Why workspaces are gitignored

User-created workspaces are local working areas, not framework. The `.gitignore` only allows `_scaffold/` and this README to be committed; everything else is yours to keep private (or version separately).
