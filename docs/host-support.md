# Host support

Codex and Claude Code are the first supported Hames hosts. Both packages contain the same four skills, runtime, schemas, templates, and hook logic. Only manifest placement and host metadata differ.

## Codex

The generated package uses `.codex-plugin/plugin.json`, `skills/`, and the default `hooks/hooks.json` discovery location. Codex requires non-managed plugin hooks to be reviewed and trusted; installing a plugin alone does not prove that its hooks ran.

## Claude Code

The generated package uses `.claude-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`. Hook commands use `CLAUDE_PLUGIN_ROOT`; Codex also supplies this variable for Claude compatibility.

## Current limits

Grok Build, Gemini CLI, Antigravity, Cursor, and other hosts are not officially supported. A host reading some Claude-compatible files is not sufficient evidence of compatibility. Each future host needs manifest discovery, skill discovery, hook lifecycle, blocking output, session identity, and representative workflow tests.

Automated package tests do not replace a fresh-session host test. Before release, verify that `/setup`, `/ready`, `/go`, and `/doctor` are discoverable in new Codex and Claude Code sessions and that representative project flows reach the expected hook and state transitions.
