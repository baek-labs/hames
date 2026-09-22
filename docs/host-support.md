# Host support

Codex and Claude Code receive the same five skills and shared runtime in generated packages. Host manifest locations differ. Node.js must be available to execute the bundled hooks; ordinary Hames work needs no Git.

Use a fresh session after installing or updating a package. The startup hook can invite first-use setup; if hooks are unavailable or untrusted, `/setup` starts the same conversation explicitly. Do not treat manifest discovery as proof that hooks ran.

- Codex: `.codex-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`. The host reports apply_patch arguments in `tool_input.command` and post-tool output in `tool_response`. Plugin hook trust belongs to the host.
- Claude Code: `.claude-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`. `--plugin-dir` can load the package for a test session without installing it globally.

[Official Codex hook reference](https://learn.chatgpt.com/docs/hooks) describes tool coverage and trust separately. Hames diagnostics report wiring, local observations and unverified trust independently. Neither shell nor unstructured UI enforcement is a complete security sandbox.

Other hosts are not officially supported. Actual tested versions, operating system, result artifacts and any blocked checks are recorded in [verification](verification.md). Do not infer Windows or Linux validation from portable path code alone.
