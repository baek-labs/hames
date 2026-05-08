param(
    # No ValidateSet: workspace names are user-defined. The lock script accepts
    # any string; the consumer (workspace_guard.js) validates against the
    # active workspaces declared in .claude/workspace_paths.json.
    [string]$Workspace = '',

    [switch]$Unlock,

    [string]$SessionId = ''
)

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$HamesRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$LockFile = Join-Path $HamesRoot '.claude\.workspace_lock'

if (-not $SessionId) {
    $SessionId = $env:HAMES_SESSION_ID
}
if (-not $SessionId) {
    $SessionId = $env:CODEX_THREAD_ID
}
if (-not $SessionId) {
    $SessionId = $env:CLAUDE_SESSION_ID
}
if (-not $SessionId) {
    $SessionId = $env:GEMINI_SESSION_ID
}
if (-not $SessionId) {
    $SessionId = $env:SESSION_ID
}

# Fallback: walk the parent process chain looking for a Claude session_id
# stashed by .claude/hooks/session_capture.js (SessionStart hook).
# Claude Code does not export CLAUDE_SESSION_ID; this fallback bridges the gap
# so per-Claude-window locks work the same way Codex's CODEX_THREAD_ID does.
$sessionsDir = Join-Path $HamesRoot '.claude\sessions'
if (-not $SessionId -and (Test-Path -LiteralPath $sessionsDir)) {
    $cur = $PID
    for ($depth = 0; $depth -lt 12 -and $cur -gt 0; $depth++) {
        $candidate = Join-Path $sessionsDir "$cur.id"
        if (Test-Path -LiteralPath $candidate) {
            $captured = (Get-Content -LiteralPath $candidate -Raw -ErrorAction SilentlyContinue).Trim()
            if ($captured) {
                $SessionId = $captured
                break
            }
        }
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction Stop
        } catch {
            break
        }
        if (-not $proc -or -not $proc.ParentProcessId) { break }
        $cur = [int]$proc.ParentProcessId
    }
}

# Last-resort fallback: parent walk failed (Claude Desktop multi-process
# architecture sometimes detaches our PowerShell from the host process tree).
# Scan .claude/sessions/ for .id files whose PID is currently alive.
# - exactly 1 alive PID  -> use it (only one host instance is running)
# - >1 alive PIDs        -> ambiguous, refuse with clear instructions
if (-not $SessionId -and (Test-Path -LiteralPath $sessionsDir)) {
    $alive = @()
    foreach ($f in Get-ChildItem -LiteralPath $sessionsDir -Filter '*.id' -ErrorAction SilentlyContinue) {
        $pidNum = 0
        if ([int]::TryParse($f.BaseName, [ref]$pidNum)) {
            if (Get-Process -Id $pidNum -ErrorAction SilentlyContinue) {
                $alive += [pscustomobject]@{
                    Pid = $pidNum
                    SessionId = (Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue).Trim()
                    MTime = $f.LastWriteTime
                }
            }
        }
    }

    $uniqueSids = @($alive | Where-Object { $_.SessionId } | Select-Object -ExpandProperty SessionId -Unique)

    if ($uniqueSids.Count -eq 1) {
        $SessionId = $uniqueSids[0]
        Write-Host "[set_workspace_lock] parent-chain walk failed; using only-alive session $SessionId as fallback."
    } elseif ($uniqueSids.Count -gt 1) {
        $listing = ($alive | Sort-Object MTime -Descending | ForEach-Object { "  PID=$($_.Pid)  sid=$($_.SessionId)  mtime=$($_.MTime)" }) -join "`n"
        throw @"
SessionId resolution ambiguous: multiple live host sessions detected.
Re-run with -SessionId <id> to disambiguate.

Live candidates:
$listing
"@
    }
}

function ConvertTo-LockState {
    param([object]$Raw)

    # Schema: { "version": 2, "sessions": { "<sid>": { workspace, locked, updated_at } } }
    # default / legacy flat 포맷은 더 이상 사용하지 않음.
    $state = [ordered]@{
        version = 2
        sessions = [ordered]@{}
    }

    if ($null -eq $Raw) {
        return $state
    }

    if ($Raw.PSObject.Properties.Name -contains 'sessions' -and $Raw.sessions) {
        foreach ($prop in $Raw.sessions.PSObject.Properties) {
            $state.sessions[$prop.Name] = [ordered]@{
                workspace = $prop.Value.workspace
                locked = [bool]$prop.Value.locked
                updated_at = $prop.Value.updated_at
            }
        }
    }

    return $state
}

$raw = $null
if (Test-Path -LiteralPath $LockFile) {
    $content = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8
    if ($content.Trim()) {
        $raw = $content | ConvertFrom-Json
    }
}

$state = ConvertTo-LockState -Raw $raw
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

if ($SessionId) {
    if ($Unlock) {
        $state.sessions[$SessionId] = [ordered]@{
            workspace = $null
            locked = $false
            updated_at = $now
        }
        $status = "[WORKSPACE LOCK] Session: $SessionId | Active: ROOT | Lock: OFF"
    } else {
        if (-not $Workspace) {
            throw 'Workspace is required unless -Unlock is used.'
        }
        $state.sessions[$SessionId] = [ordered]@{
            workspace = $Workspace
            locked = $true
            updated_at = $now
        }
        $status = "[WORKSPACE LOCK] Session: $SessionId | Active: $Workspace | Lock: ON"
    }
} else {
    throw 'SessionId is required. Provide -SessionId or set HAMES_SESSION_ID / CODEX_THREAD_ID / CLAUDE_SESSION_ID / GEMINI_SESSION_ID. Lock state is per-session only — there is no global default.'
}

$json = $state | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($LockFile, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host $status
