---
name: "source-command-handoff"
description: "Create a model handoff using a single canonical handoff document and then validate it."
---

# source-command-handoff

Use this skill when the user asks to run the migrated source command `handoff`.

## Command Template

# /handoff

Usage: `/handoff <target_model>`

Examples:
- `/handoff gemini`
- `/handoff codex`
- `/handoff claude`

## Flow

**Step 1 — Confirm target model**
- Read the user-provided argument and extract the target model (`claude`, `gemini`, or `codex`).
- If no target model is given, ask which model should receive the handoff.

**Step 2 — Summarize the current session**
From the active conversation and working context, prepare:
- `task_summary`
- `current_state`
- `next_step`
- `source_model`
- `source_workspace`
- `handoff_id` in the format `HAMES-{YYYYMMDD}-{KEYWORD}` or `SESSION-{YYYY-MM-DD}-{LETTER}`

`source_workspace` must be the real workspace where the work happened. Do not use AI_COMM as the source workspace.

**Step 3 — Create the handoff file**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/create_handoff.ps1 `
  -HandoffId "<handoff_id>" `
  -TargetModel "<target_model>" `
  -SourceModel "<source_model>" `
  -SourceWorkspace "<source_workspace>" `
  -TaskSummary "<task_summary>" `
  -CurrentState "<current_state>" `
  -NextStep "<next_step>"
```

`create_handoff.ps1` builds the handoff document directly from these arguments. Do not depend on `.hames_context.json`.

**Step 4 — Refresh target bootstrap only if needed**

For `gemini`:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/start_hames_gemini.ps1 `
  -Task "<task_summary>" `
  -TargetPath "<source_workspace>" `
  -Handoff
```

For `codex`:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/start_hames_codex.ps1 `
  -Task "<task_summary>" `
  -TargetPath "<source_workspace>" `
  -Handoff
```

For `claude`, skip bootstrap generation.

**Step 5 — Validate**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/validate_handoff.ps1 `
  -HandoffFile "ai_comm/_Inbox/Handoff_<handoff_id>.md"
```

**Step 6 — Report**
- PASS: report the handoff file path, bootstrap file path if one was generated, and the handoff id.
- FAIL: report the missing fields or validation failures and request manual correction.
