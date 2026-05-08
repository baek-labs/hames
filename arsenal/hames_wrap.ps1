<#
.SYNOPSIS
    Hames 방어선 4 — Wrapper Script. 사용자 CLI 세션 시작 시 6개 룰 파일을 모델이 강제로 읽도록 사전 지시 주입.

.DESCRIPTION
    두 가지 동작 모드:

    1. Interactive (기본) — CLI 대화형 세션 시작.
       짧은 사전 지시(pre-flight) 프롬프트로 6개 파일 read + Loaded/Signatures 헤더 출력 + 사용자 task 처리 명령.
       이후 사용자는 같은 세션에서 자유롭게 후속 대화 가능.
       Defense lines 1/2/3 (텍스트 강제 + Hook)이 파일 read 강제력 보장.

    2. Headless (-Headless 플래그) — 1회성 비대화형 호출.
       6개 파일 본문 전체를 stdin으로 모델에 직접 주입 후 한 번 응답 받고 종료.
       자동화 / 스크립트 / 빠른 단답 용도.

    환경 적용 범위:
      - Claude Code CLI / Gemini CLI / Codex CLI: 본 스크립트 사용
      - IDE/앱 환경(Cursor, Antigravity, Codex App): 자체 로딩 메커니즘 사용 — 본 스크립트 불필요

.PARAMETER Model
    대상 모델: claude | gemini | codex

.PARAMETER Prompt
    사용자 실제 프롬프트(질문/작업 내용).

.PARAMETER WorkspacePath
    선택. 활성 워크스페이스 경로(예: "workspaces/Investment"). 지정 시 사전 지시에 명시.

.PARAMETER Headless
    플래그. 비대화형 1회 모드로 전환. 6개 파일 본문 전체 stdin 주입. 응답 후 즉시 종료.

.PARAMETER DryRun
    플래그. 모델 호출 없이 사전 지시(또는 합성 프롬프트) 내용만 stdout 출력.

.EXAMPLE
    # 인터랙티브 (기본): 사용자가 평소 사용
    powershell -File arsenal/hames_wrap.ps1 -Model gemini -Prompt "구글 1분기 실적 분석해줘"

.EXAMPLE
    # 인터랙티브 + 워크스페이스 지정
    powershell -File arsenal/hames_wrap.ps1 -Model gemini -Prompt "포트폴리오 검토" -WorkspacePath "workspaces/Investment"

.EXAMPLE
    # 헤드리스 1회 호출 (자동화/스크립트용)
    powershell -File arsenal/hames_wrap.ps1 -Model gemini -Prompt "오늘 코스피 동향 한 줄 요약" -Headless

.EXAMPLE
    # 검증 모드 (모델 호출 없이 사전 지시만 출력)
    powershell -File arsenal/hames_wrap.ps1 -Model claude -Prompt "test" -DryRun
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('claude','gemini','codex')]
    [string]$Model,

    [Parameter(Mandatory=$true)]
    [string]$Prompt,

    [string]$WorkspacePath = "",

    [switch]$Headless,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# UTF-8 output bootstrap (Windows PowerShell 5.1 CP949/ASCII output avoidance)
$Utf8Bootstrap = Join-Path $PSScriptRoot "set_hames_utf8.ps1"
if (Test-Path -LiteralPath $Utf8Bootstrap) {
    . $Utf8Bootstrap
} else {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding           = [System.Text.Encoding]::UTF8
    $env:PYTHONIOENCODING     = "utf-8"
}

$HamesRoot = "{{HAMES_ROOT}}"

if ($env:HAMES_SESSION_ID) {
    $HamesSessionId = $env:HAMES_SESSION_ID
} else {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $chars = [char[]]'0123456789abcdef'
    $suffix = -join (1..6 | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
    $HamesSessionId = "$Model-$stamp-$suffix"
}

# ─── 6개 필수 파일 (방어선 1/2/3 대상과 동일) ─────────────────────────────────
$MandatoryFiles = @(
    "CLAUDE.md",
    ".cursor\rules\prompt_engineering.md",
    ".cursor\rules\context_engineering.md",
    ".cursor\rules\agent_engineering.md",
    ".cursor\rules\harness_engineering.md",
    "arsenal\CLAUDE.md"
)
$EnforcementFile = ".cursor\rules\enforcement.md"

$workspaceLabel = if ($WorkspacePath) { $WorkspacePath } else { "ROOT (no specific workspace)" }

# ─── 사전 지시(pre-flight) — 인터랙티브용 짧은 시동 프롬프트 ──────────────────
$preflight = @"
[Hames Pre-flight — defense line 4 wrapper]

You are starting a Hames-bound CLI session.
Working directory: $HamesRoot
Active workspace: $workspaceLabel
Hames session id: $HamesSessionId

BEFORE any other action, you MUST:

1. Read these 6 files in order from CWD (use the Read tool):
   - CLAUDE.md (kernel)
   - .cursor/rules/prompt_engineering.md
   - .cursor/rules/context_engineering.md
   - .cursor/rules/agent_engineering.md
   - .cursor/rules/harness_engineering.md
   - arsenal/CLAUDE.md
   And: .cursor/rules/enforcement.md (defense lines 1/2/3/4 single source of truth)

2. Output exactly this 2-line header in your first substantive response:
   Loaded: CLAUDE.md, prompt_engineering.md, context_engineering.md, agent_engineering.md, harness_engineering.md, arsenal/CLAUDE.md
   Signatures: HAMES SYSTEM KERNEL v5.5 | DEEP_TASK_PROTOCOL | FIXED LOAD ORDER | COO ROUTER | DEFINED_CRITICAL_ACTIONS | HAMES ARSENAL

3. Then handle this initial user task:
$Prompt

4. After handling, the session continues interactively — user may ask follow-up questions.

Constraints:
- Skipping the file reads is forbidden. Defense line 3 (PreToolUse hook in .claude/hooks/context_verifier.js) blocks Write/Edit/Bash without the Signatures header.
- Workspace lock + harness rules apply throughout the session. The launcher/runtime already assigned the session key; users only choose the workspace when using /lock.
- exit 2 from any hook = blocked tool. Read stderr and respond accordingly.
"@

# ─── DryRun: 사전 지시(또는 헤드리스 합성)만 출력 ─────────────────────────────
if ($DryRun -and -not $Headless) {
    Write-Host $preflight
    Write-Host ""
    Write-Host "[DRY-RUN / Interactive] 사전 지시 길이: $($preflight.Length) chars" -ForegroundColor Yellow
    Write-Host "[DRY-RUN] 실제 호출 시 위 텍스트로 $Model 인터랙티브 세션 시작." -ForegroundColor Yellow
    exit 0
}

# ─── Headless 모드: 6개 파일 본문 전체 stdin 주입 (기존 1회성 동작) ──────────
if ($Headless) {
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine("=" * 78)
    [void]$builder.AppendLine("HAMES SYSTEM — 방어선 4 사전 주입 (Headless mode)")
    [void]$builder.AppendLine("Model: $Model | Workspace: $workspaceLabel | Session: $HamesSessionId | Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$builder.AppendLine("=" * 78)
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("Loaded: CLAUDE.md, prompt_engineering.md, context_engineering.md, agent_engineering.md, harness_engineering.md, arsenal/CLAUDE.md")
    [void]$builder.AppendLine("Signatures: HAMES SYSTEM KERNEL v5.5 | DEEP_TASK_PROTOCOL | FIXED LOAD ORDER | COO ROUTER | DEFINED_CRITICAL_ACTIONS | HAMES ARSENAL")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("=" * 78)
    [void]$builder.AppendLine()

    foreach ($rel in ($MandatoryFiles + @($EnforcementFile))) {
        $path = Join-Path $HamesRoot $rel
        if (-not (Test-Path $path)) {
            Write-Error "[hames_wrap] Mandatory file missing: $path"
            exit 1
        }
        [void]$builder.AppendLine("# ─── FILE: $rel ───")
        [void]$builder.AppendLine()
        [void]$builder.AppendLine((Get-Content -Raw -Path $path -Encoding UTF8))
        [void]$builder.AppendLine()
    }

    if ($WorkspacePath) {
        $wsRoot = Join-Path $HamesRoot $WorkspacePath
        foreach ($candidate in @("CLAUDE.md", "AGENTS.md", "_Master", "_Index.md")) {
            $path = Join-Path $wsRoot $candidate
            if (Test-Path $path) {
                $rel = $path.Substring($HamesRoot.Length + 1) -replace "\\", "/"
                if (Test-Path -PathType Container $path) {
                    [void]$builder.AppendLine("# ─── DIR: $rel ───")
                    Get-ChildItem -Path $path -Filter "*.md" -Recurse | ForEach-Object {
                        $relInner = $_.FullName.Substring($HamesRoot.Length + 1) -replace "\\", "/"
                        [void]$builder.AppendLine()
                        [void]$builder.AppendLine("## ─ $relInner ─")
                        [void]$builder.AppendLine((Get-Content -Raw -Path $_.FullName -Encoding UTF8))
                    }
                } else {
                    [void]$builder.AppendLine("# ─── FILE: $rel ───")
                    [void]$builder.AppendLine()
                    [void]$builder.AppendLine((Get-Content -Raw -Path $path -Encoding UTF8))
                }
                [void]$builder.AppendLine()
            }
        }
    }

    [void]$builder.AppendLine("=" * 78)
    [void]$builder.AppendLine("# 사용자 작업 요청")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine($Prompt)
    $composite = $builder.ToString()

    if ($DryRun) {
        Write-Host $composite
        Write-Host ""
        Write-Host "[DRY-RUN / Headless] 합성 프롬프트 길이: $($composite.Length) chars" -ForegroundColor Yellow
        exit 0
    }

    Write-Host "[hames_wrap / Headless] $Model 1회 호출 (합성 길이: $($composite.Length) chars)..." -ForegroundColor Cyan

    $tmp = New-TemporaryFile
    $tmp = "$($tmp.FullName).hames.txt"
    [System.IO.File]::WriteAllText($tmp, $composite, [System.Text.UTF8Encoding]::new($false))
    $previousHamesSessionId = $env:HAMES_SESSION_ID
    $env:HAMES_SESSION_ID = $HamesSessionId
    try {
        switch ($Model) {
            'claude' { Get-Content -Raw -Path $tmp | claude -p }
            'gemini' { Get-Content -Raw -Path $tmp | gemini -p }
            'codex'  { Get-Content -Raw -Path $tmp | codex exec - }
        }
    } finally {
        Remove-Item -Path $tmp -ErrorAction SilentlyContinue
        if ($previousHamesSessionId) {
            $env:HAMES_SESSION_ID = $previousHamesSessionId
        } else {
            Remove-Item Env:HAMES_SESSION_ID -ErrorAction SilentlyContinue
        }
    }
    exit 0
}

# ─── Interactive 모드 (기본): 짧은 사전 지시로 인터랙티브 세션 시작 ───────────
Write-Host "[hames_wrap / Interactive] $Model 대화형 세션 시작..." -ForegroundColor Cyan
Write-Host "[hames_wrap] 사전 지시 길이: $($preflight.Length) chars (룰 본문은 모델이 직접 read)" -ForegroundColor Cyan
Write-Host "[hames_wrap] HAMES_SESSION_ID: $HamesSessionId" -ForegroundColor Cyan
Write-Host ""

# 작업 디렉토리를 Hames 루트로 강제 (모델이 상대경로 read 가능하도록)
$previousHamesSessionId = $env:HAMES_SESSION_ID
$env:HAMES_SESSION_ID = $HamesSessionId
Push-Location $HamesRoot
try {
    switch ($Model) {
        'claude' {
            # Claude Code CLI: positional 인자가 초기 메시지로 인식됨, 이후 인터랙티브
            & claude $preflight
        }
        'gemini' {
            # Gemini CLI: -i / --prompt-interactive 플래그 = 초기 프롬프트 + 인터랙티브 유지
            & gemini -i $preflight
        }
        'codex' {
            # Codex CLI: positional [PROMPT] 인자 = 초기 프롬프트, 이후 인터랙티브 진행
            & codex $preflight
        }
    }
} finally {
    Pop-Location
    if ($previousHamesSessionId) {
        $env:HAMES_SESSION_ID = $previousHamesSessionId
    } else {
        Remove-Item Env:HAMES_SESSION_ID -ErrorAction SilentlyContinue
    }
}
