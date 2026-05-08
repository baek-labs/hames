param(
    [string]$Task       = "Session activation requested by CEO",
    [string]$Agent      = "",
    [string]$TargetPath = "",
    [switch]$Handoff,
    [switch]$LockSession
)

$Utf8Bootstrap = Join-Path $PSScriptRoot "set_hames_utf8.ps1"
if (Test-Path -LiteralPath $Utf8Bootstrap) {
    . $Utf8Bootstrap
}

$HamesRoot    = "{{HAMES_ROOT}}"
$StartFile    = Join-Path $HamesRoot "Anti\999_AI_Communication\Memory\.hames_start_gemini.md"

# --- Self-Contained Workspace Inference ---
$searchPath = if ($TargetPath) { $TargetPath } else { (Get-Location).Path }
$searchPath = $searchPath -replace "\\", "/"

$workspace     = "ROOT"
$workspacePath = ""

if     ($searchPath -match "workspaces/Investment") { $workspace = "INVEST";   $workspacePath = "workspaces/Investment" }
elseif ($searchPath -match "workspaces/Business")   { $workspace = "BUSINESS"; $workspacePath = "workspaces/Business"   }
elseif ($searchPath -match "workspaces/Company")    { $workspace = "COMPANY";  $workspacePath = "workspaces/Company"    }
elseif ($searchPath -match "workspaces/Hobby")      { $workspace = "HOBBY";    $workspacePath = "workspaces/Hobby"      }

$agentTeam = if ($Agent) { $Agent } else { "COO" }

$loadOrderText = if ($workspacePath) {
"  - CLAUDE.md (루트 글로벌 룰)
  - $workspacePath/CLAUDE.md
  - $workspacePath/_Master
  - $workspacePath/_Index.md"
} else {
"  - CLAUDE.md (루트 글로벌 룰)"
}

$outputZone = switch ($workspace) {
    "INVEST"   { "workspaces/Investment/03_Reports"  }
    "BUSINESS" { "workspaces/Business"               }
    "COMPANY"  { "workspaces/Company/06_Reports"     }
    "HOBBY"    { "workspaces/Hobby/01_Novel"         }
    default    { ""                               }
}

$handoffReq = if ($Handoff) { "True" } else { "False" }
$sessionLock = if ($LockSession) { "ON" } else { "OFF" }

$lockRuleText = if ($LockSession) {
"- Session is locked to the workspace/agent-team/task above.
- Stay inside the workspace above for this session."
} else {
"- Session is advisory by default.
- Do not lock workspace/agent-team/task until the user explicitly decides."
}

# --- Write Session Bootstrap ---
$startupPrompt = @"
# Hames Gemini Session Bootstrap

This file is the highest-priority bootstrap for the current Gemini session.

- Current workspace: $workspace
- Workspace path: $workspacePath
- Agent team: $agentTeam
- Output destination: $outputZone
- Handoff required: $handoffReq
- Session lock: $sessionLock

Read in this exact order before doing substantive work:
$loadOrderText

Rules:
$lockRuleText
- Final outputs must stay in the source workspace, not AI_COMM.
- Use AI_COMM only when the user explicitly requests a model handoff.
- Before creating a file, run: powershell -File arsenal/run_hames_guarded.ps1 -Mode PreflightWrite -TargetFile <file>
- Before editing an existing file, run: powershell -File arsenal/run_hames_guarded.ps1 -Mode PreflightEdit -TargetFile <file> -OldString <exact_old> -NewString <new_text>
- After editing an existing file, run: powershell -File arsenal/run_hames_guarded.ps1 -Mode FinalizeEdit -TargetFile <file> -OldString <exact_old> -NewString <new_text>
- Before shell execution, run: powershell -File arsenal/run_hames_guarded.ps1 -Mode PreflightBash -Command <command>
- Before formal completion, run: powershell -File arsenal/run_hames_guarded.ps1 -Mode VerifyFile -TargetFile <file>

Current task:
$Task
"@

$startupPrompt | Set-Content -LiteralPath $StartFile -Encoding UTF8

# --- Gemini Startup Instructions ---
Write-Host "=== GEMINI STARTUP ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Enforcement : Operational discipline (no hard hooks)"
Write-Host "  Compliance  : Guided. Verifier pass required for formal completion."
Write-Host "  Session lock: $sessionLock"
Write-Host ""
Write-Host "  Session bootstrap written to: $StartFile"
Write-Host "  Gemini should read that file first through .cursorrules session override."
Write-Host ""
Write-Host "  ----------------------------------------------------------------"

Write-Host $startupPrompt
Write-Host "  ----------------------------------------------------------------"
Write-Host ""
if ($handoffReq -eq "True") {
    Write-Host "  [HANDOFF REQUIRED]" -ForegroundColor Yellow
    Write-Host "  When done, create handoff in: ai_comm/_Inbox/"
    Write-Host "  Use template from: ai_comm/PROTOCOL.md"
    Write-Host ""
}
