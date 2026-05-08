# Glossary

Terms used across Hames documentation. Listed alphabetically.

---

**AI_COMM** — Handoff buffer used when switching models mid-task. Stores task state, constraints, referenced files. Not a workspace, not an executor — strictly a continuity mechanism.

**Arsenal** — The tool registry directory (`arsenal/`). Contains scripts that agents can invoke (PDF processing, web search, hooks, etc.). The registry's `CLAUDE.md` lists invocations only — descriptions live elsewhere.

**Audit Log** — Per-machine log at `.claude/workspace_audit.log`. Records every PreToolUse hook decision (PASS / BLOCKED / SKIPPED with reason). Gitignored.

**CEO** — The operator. The human who runs the system. Distinct from Hames the COO.

**Confirmation Block** — The two-line `Loaded:` and `Signatures:` block required in the first substantive response. Defense line 2.

**COO** — "Chief Operating Officer". The router agent named Hames. Does not execute substantive tasks; spawns Level-1 agents.

**Critical Action** — One of `DELETE_FILE`, `OVERWRITE_EXISTING`, `SEND_EMAIL`, `DEPLOY_CODE`, `EXECUTE_SHELL`, `MOVE_FILE`. Requires explicit user approval before execution.

**Defense Line** — One of four layered enforcement mechanisms:
1. Mandatory full read of six core files
2. Confirmation block in first response
3. PreToolUse hook verifies signatures in transcript
4. Wrapper script pre-injects rule content for headless invocations

**FIXED LOAD ORDER** — The mandatory sequence for loading workspace context: workspace `CLAUDE.md` → `_Master/` → `_Index.md` → task-specific files.

**Frontmatter Blocking** — The `verify_frontmatter_block.js` hook that blocks `Write` to workspace markdown files missing required frontmatter fields.

**FULL Mode** — Level-1 agent uses its full sub-team pipeline (e.g., CTO uses architect → coder → reviewer).

**Harness** — The hook layer that enforces safety rules. PreToolUse and PostToolUse hooks across `.claude/hooks/` and `arsenal/`.

**Isolated Domain** — A workspace with its own agent team, hooks, and explicit trigger phrase. Default installation has none. See `04_workspace_model.md`.

**Kernel** — `CLAUDE.md` plus the five rule modules. The system's core ruleset.

**Level-1 Agent** — Domain-level agent: CFO, CSO, CBO, CTO, Marketer. Spawned by the COO.

**Level-2 Sub-team** — Specialized members of a Level-1 team (e.g., CTO's `architect`, `coder`, `reviewer`).

**LITE Mode** — Level-1 agent handles the task directly without spawning the sub-team. Used for simple tasks where the pipeline overhead exceeds the value.

**Negative Claim Verification** — The rule that the model must dump raw evidence before claiming "no changes / clean / passed / nothing missing". Defense against hallucinated negative results.

**PostToolUse Hook** — A hook that fires after a tool succeeds. Cannot block; can warn, audit, or trigger downstream.

**PreToolUse Hook** — A hook that fires before a tool runs. Non-zero exit blocks the tool.

**Rational Materialism** — The system's stated philosophy: every rule has an articulated reason (rational) backed by concrete enforcement (material).

**Session Lock / Workspace Lock** — When ON via `/lock <workspace>`, blocks file writes outside the active workspace. SYSTEM_ADMIN paths remain writable.

**Signatures** — The six load-bearing phrases that confirm the six core rule files were read. Listed in `.claude/context_signatures.json`. Checked by `context_verifier.js`.

**Spawn Protocol** — The decision rule for when COO must spawn a Level-1 agent vs handle directly. Defined in `agent_engineering.md` [2.7].

**SYSTEM_ADMIN paths** — `arsenal/`, `.claude/`. Always writable regardless of workspace lock state. Required for the harness itself to update.

**Token (placeholder)** — `{{CEO_NAME}}`, `{{HAMES_ROOT}}`, etc. Rendered by `init.{ps1|sh}` with operator-specific values.

**VETO** — A Level-2 auditor's ability to reject the writer/coder's output. Forces the parent Level-1 agent to re-spawn.

**Workspace** — An execution context. Defines output destination, naming, frontmatter. Tasks route to a workspace first, then to an agent.

**Worklog** — `<Task>_Worklog.md`. Created by the DEEP_TASK_PROTOCOL when complexity is high. Contains plan / discoveries / progress / errors.
