# Verification evidence

## Automated checks

Final post-fix suite: `node --test --test-timeout=120000` — **112 passed, 0 failed, exit 0** (2026-09-22, 26.8 seconds). Raw receipts: `tests/.tmp/final-suite.log` and `tests/.tmp/final-suite.exit`. The following earlier checks are retained as the verification history.

- `node --test --test-timeout=120000`: 105 tests passed, exit 0 before the native-command evidence adapter correction (2026-09-22). Raw output: ignored `tests/.tmp/full-suite.log` and exit receipt `full-suite.exit`.
- After that correction, `node --test tests/guards/*.test.js tests/contract/*.test.js`: 44 passed, exit 0, including exact native Bash command matching and file verification with an after phase.
- Setup/config: 21 passed; index maintenance: 9 passed; scoped context and hooks: 7 passed in targeted runs.
- Distribution checks: 10 passed, including deterministic builds and tamper detection.
- `node scripts/build.mjs`, `node scripts/verify.mjs`, `git diff --check`: exit 0.
- Two consecutive builds produced identical package bytes. Both generated manifests passed their host validators. The Python validator used an isolated temporary virtual environment, without changing managed plugins or global Python packages.

## Native host observations

Test machine: macOS. Claude Code 2.1.278; Codex CLI 0.155.1. Other operating systems are not validated by these observations.

Claude Code was loaded through a per-session `--plugin-dir` with user/project settings sources disabled, strict empty MCP configuration, and no session persistence. It reused the native existing login; no global plugin installation or credential copy was performed. This is per-session plugin/settings isolation, not a claim that the host performs zero incidental writes to its own cache.

Observed in fresh Claude sessions:

- First-use guidance described user-selected roots, workspace roles, preview and approval, with no fixture file creation.
- Init event discovered `hames:setup`, `hames:ready`, `hames:go`, `hames:index`, `hames:doctor` from the 3.0.0 generated package.
- Native Write created `work/probe.md`; `work/_Index.md` was updated by the hook, not by the model editing the index.
- A local PostToolUse receipt recorded `tool: Write` and successful index maintenance.
- Startup context supplied the common and work sentinels, not the unrelated study sentinel.

Evidence is in ignored `tests/.tmp/claude-smoke/first-use.json`, `configured.jsonl`, and the fixture's `.hames/state/hook-observations.json`. Manual reproducer: `node tests/host/claude-smoke.js`.

A first ready/go native run was stopped following a user direction, after readiness and before complete verification. It is not a pass. The subsequent retry is recorded by `tests/host/claude-workflow.py`; its latest receipt is `tests/.tmp/claude-smoke/latest-workflow.json`. Run `26b56b59` completed all three user turns without an error: the exact file contents matched, hook-bound evidence passed, the contract reached ARCHIVED after acceptance, and the native read-only index audit reported zero issues. Actual tool commands contained no Git mutations. The archived test contract and its evidence remain under the ignored fixture `tests/.tmp/claude-workflow-26b56b59`.

Codex discovered the local 3.0.0 marketplace package using process-local configuration overrides, but it was not installed. A fresh ephemeral model session with the same overrides returned `NOT_DISCOVERED` for Hames skills. Therefore Codex plugin discovery, hook trust/execution and full workflow are not yet verified. This execution has not changed the user's global plugin installation or hook trust to bypass that boundary. On 2026-09-22 the user explicitly took ownership of local installation/execution and requested closure without further agent-run installation or execution checks. Codex live execution remains unverified, not failed or passed.

## Completion boundary

The native Claude workflow passed. Independent code review identified five blocking defects and two additional observations. They were corrected with regression tests; the independent reviewer rechecked those exact items and confirmed all resolved with no remaining blocker in that scope. Automated success and package generation do not prove both hosts' end-to-end operation. No commit, push, public release or marketplace publication has occurred in this execution.

## User handoff and closure

On 2026-09-22, the user requested that local installation and execution be performed personally and excluded from this execution's remaining completion gates. Implementation, generated packages, automated validation, documentation and independent defect recheck are complete. Local installation/execution is handed to the user; no global installation, hook-trust change, commit, push or publication was performed by this task.
