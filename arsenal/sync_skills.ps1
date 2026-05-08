<#
.SYNOPSIS
    Hames 슬래시 커맨드 스킬 디렉토리 Codex 정본 + Antigravity 미러 + Gemini CLI 커맨드 동기화.

.DESCRIPTION
    스킬 형식(SKILL.md)을 사용하는 환경 중 Codex CLI/App은 같은
    .codex/skills 정본을 읽고, Antigravity용 .agent/skills만 미러한다.
    Gemini CLI용 .gemini/commands/*.toml 표면도 Codex 정본의 source-command
    목록과 맞는지 확인하고, 생성 가능한 누락 커맨드는 만든다.
    Codex hook 설정 표면(.codex/hooks.json, .codex/config.toml)도 같은
    repo-root 기반 command set으로 동기화한다.

    단일 소스: .codex/skills/   (Codex CLI/App 공용 정본)
    미러 타겟: .agent/skills/    (Antigravity)
    Gemini CLI: .gemini/commands/*.toml

    참고:
      - .claude/commands/*.md  (Claude Code 형식, 다른 포맷이라 sync 대상 아님)
      - legacy .agents skill path (존재하지 않는 경로; 중복 노출을 막기 위해 사용하지 않음)

    Claude Code 명령은 형식 자체가 달라 파일 내용을 직접 미러하지 않는다.

.PARAMETER DryRun
    플래그. 실제 복사 없이 변경 예정 항목만 보고.

.EXAMPLE
    powershell -File arsenal/sync_skills.ps1

.EXAMPLE
    powershell -File arsenal/sync_skills.ps1 -DryRun
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

$HamesRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Source    = Join-Path $HamesRoot ".codex\skills"
$Targets   = @(
    (Join-Path $HamesRoot ".agent\skills")
)
$CodexHooksJson  = Join-Path $HamesRoot ".codex\hooks.json"
$CodexConfigToml = Join-Path $HamesRoot ".codex\config.toml"
$GeminiCommands  = Join-Path $HamesRoot ".gemini\commands"

if (-not (Test-Path $Source)) {
    Write-Error "[sync_skills] Source not found: $Source"
    exit 1
}

$prefix = if ($DryRun) { "[DRY-RUN]" } else { "[sync_skills]" }

Write-Host "$prefix Source: $Source" -ForegroundColor Cyan
Write-Host "$prefix Targets:" -ForegroundColor Cyan
foreach ($t in $Targets) {
    Write-Host "  - $t" -ForegroundColor Cyan
}
Write-Host ""

# 소스 스킬 목록
$sourceSkills = Get-ChildItem -Path $Source -Directory | Sort-Object Name
Write-Host "$prefix 소스 스킬 $($sourceSkills.Count)개:" -ForegroundColor Cyan
foreach ($s in $sourceSkills) {
    Write-Host "  - $($s.Name)"
}
Write-Host ""

$totalCopied = 0
$totalRemoved = 0
$totalGeminiCreated = 0

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Content
    )
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-TextOrEmpty {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path $Path)) { return "" }
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Get-CodexHookCommandMap {
    $rootExpr = '$(git rev-parse --show-toplevel)'
    $adapter = "$rootExpr/.claude/hooks/hook_adapter.js"
    return [ordered]@{
        context_verifier = "node `"$adapter`" `"$rootExpr/.claude/hooks/context_verifier.js`""
        workspace_guard = "node `"$adapter`" `"$rootExpr/.claude/hooks/workspace_guard.js`""
        compliance_auditor = "node `"$adapter`" `"$rootExpr/arsenal/compliance_auditor.js`""
        verify_frontmatter_block = "node `"$adapter`" `"$rootExpr/arsenal/verify_frontmatter_block.js`""
        verify_edit_surgery = "node `"$adapter`" `"$rootExpr/arsenal/verify_edit_surgery.js`""
        verify_tasks = "node `"$adapter`" `"$rootExpr/arsenal/verify_tasks.js`""
        update_arsenal_permissions = "node `"$adapter`" `"$rootExpr/arsenal/update_arsenal_permissions.js`""
        index_post_write_auditor = "python `"$rootExpr/arsenal/index_post_write_auditor.py`""
        session_logger = "node `"$adapter`" `"$rootExpr/arsenal/session_logger.js`""
    }
}

function New-CodexHooksJsonContent {
    $commands = Get-CodexHookCommandMap
    $payload = [ordered]@{
        hooks = [ordered]@{
            PreToolUse = @(
                [ordered]@{
                    matcher = "Write|Edit|MultiEdit|NotebookEdit|Bash"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.context_verifier
                        statusMessage = "Verifying context signatures..."
                    })
                },
                [ordered]@{
                    matcher = "Write|Edit|MultiEdit|NotebookEdit|Bash"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.workspace_guard
                        statusMessage = "Checking workspace lock..."
                    })
                },
                [ordered]@{
                    matcher = "Write|Edit|Bash"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.compliance_auditor
                    })
                },
                [ordered]@{
                    matcher = "Write"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.verify_frontmatter_block
                        statusMessage = "Checking frontmatter gate..."
                    })
                }
            )
            PostToolUse = @(
                [ordered]@{
                    matcher = "Edit"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.verify_edit_surgery
                    })
                },
                [ordered]@{
                    matcher = "Write|Edit"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.verify_tasks
                    })
                },
                [ordered]@{
                    matcher = "Write"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.update_arsenal_permissions
                    })
                },
                [ordered]@{
                    matcher = "Write"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.index_post_write_auditor
                        timeout = 120
                        statusMessage = "Auditing workspace index..."
                    })
                },
                [ordered]@{
                    matcher = "Write|Edit"
                    hooks = @([ordered]@{
                        type = "command"
                        command = $commands.session_logger
                        statusMessage = "Writing session log..."
                    })
                }
            )
        }
    }
    return (($payload | ConvertTo-Json -Depth 20) + "`n")
}

function Set-CodexConfigHookCommands {
    param([Parameter(Mandatory=$true)][string]$Content)

    $commands = Get-CodexHookCommandMap
    $replacements = [ordered]@{
        'context_verifier\.js' = "command = '$($commands.context_verifier)'"
        'workspace_guard\.js' = "command = '$($commands.workspace_guard)'"
        'compliance_auditor\.js' = "command = '$($commands.compliance_auditor)'"
        'verify_frontmatter_block\.js' = "command = '$($commands.verify_frontmatter_block)'"
        'verify_edit_surgery\.js' = "command = '$($commands.verify_edit_surgery)'"
        'verify_tasks\.js' = "command = '$($commands.verify_tasks)'"
        'update_arsenal_permissions\.js' = "command = '$($commands.update_arsenal_permissions)'"
        'index_post_write_auditor\.py' = "command = '$($commands.index_post_write_auditor)'"
        'session_logger\.js' = "command = '$($commands.session_logger)'"
    }

    $updated = $Content
    foreach ($pattern in $replacements.Keys) {
        $linePattern = "(?m)^command\s*=\s*'.*$pattern.*'$"
        if ($updated -notmatch $linePattern) {
            throw "[sync_skills] Missing managed Codex config hook command for pattern: $pattern"
        }
        $updated = [regex]::Replace($updated, $linePattern, $replacements[$pattern], 1)
    }
    return $updated
}

function Test-NoLocalAbsolutePath {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Content
    )
    # Detect any user-home absolute path that would not be portable across machines.
    if ($Content -match 'C:[/\\]Users[/\\][^/\\\s"'')]+|/c/Users/[^/\s"'')]+|/Users/[^/\s"'')]+|\$CLAUDE_PROJECT_DIR') {
        throw "[sync_skills] Non-portable path remains in $Path"
    }
}

function Sync-CodexHookSurfaces {
    $hooksExists = Test-Path $CodexHooksJson
    $configExists = Test-Path $CodexConfigToml
    if (-not $hooksExists -or -not $configExists) {
        Write-Host "$prefix Codex hook surface sync skipped: missing .codex/hooks.json or .codex/config.toml" -ForegroundColor Yellow
        return
    }

    $hooksInfo = Get-Item $CodexHooksJson
    $configInfo = Get-Item $CodexConfigToml
    $sourceName = if ($hooksInfo.LastWriteTime -ge $configInfo.LastWriteTime) { ".codex/hooks.json" } else { ".codex/config.toml" }

    Write-Host "$prefix Codex hook surfaces: source hint = $sourceName (newer file)" -ForegroundColor Cyan

    $desiredHooks = New-CodexHooksJsonContent
    $currentHooks = Get-TextOrEmpty $CodexHooksJson
    $currentConfig = Get-TextOrEmpty $CodexConfigToml
    $desiredConfig = Set-CodexConfigHookCommands -Content $currentConfig

    Test-NoLocalAbsolutePath -Path ".codex/hooks.json" -Content $desiredHooks
    Test-NoLocalAbsolutePath -Path ".codex/config.toml" -Content $desiredConfig

    $hooksChanged = $currentHooks -ne $desiredHooks
    $configChanged = $currentConfig -ne $desiredConfig

    if ($DryRun) {
        if ($hooksChanged) {
            Write-Host "  [DRY-RUN] would update: .codex/hooks.json" -ForegroundColor Green
        } else {
            Write-Host "  unchanged: .codex/hooks.json" -ForegroundColor Gray
        }
        if ($configChanged) {
            Write-Host "  [DRY-RUN] would update: .codex/config.toml" -ForegroundColor Green
        } else {
            Write-Host "  unchanged: .codex/config.toml" -ForegroundColor Gray
        }
    } else {
        if ($hooksChanged) {
            Write-Utf8NoBom -Path $CodexHooksJson -Content $desiredHooks
            Write-Host "  updated: .codex/hooks.json" -ForegroundColor Green
        } else {
            Write-Host "  unchanged: .codex/hooks.json" -ForegroundColor Gray
        }
        if ($configChanged) {
            Write-Utf8NoBom -Path $CodexConfigToml -Content $desiredConfig
            Write-Host "  updated: .codex/config.toml" -ForegroundColor Green
        } else {
            Write-Host "  unchanged: .codex/config.toml" -ForegroundColor Gray
        }

        Get-Content -LiteralPath $CodexHooksJson -Raw | ConvertFrom-Json -ErrorAction Stop | Out-Null
        Test-NoLocalAbsolutePath -Path ".codex/hooks.json" -Content (Get-TextOrEmpty $CodexHooksJson)
        Test-NoLocalAbsolutePath -Path ".codex/config.toml" -Content (Get-TextOrEmpty $CodexConfigToml)
        Write-Host "[sync_skills] VERIFY PASS: Codex hook surfaces synchronized" -ForegroundColor Green
    }
    Write-Host ""
}

function New-GeminiCommandContent {
    param([Parameter(Mandatory=$true)][string]$CommandName)

    # No domain-specific command templates ship in the public repo.
    # Users who add custom commands for their workspaces should provide
    # their own .toml templates and skip this auto-fill path.
    return $null
}

function Sync-GeminiCommandSurface {
    Write-Host "$prefix Gemini CLI command surface: $GeminiCommands" -ForegroundColor Cyan

    if (-not (Test-Path $GeminiCommands)) {
        if ($DryRun) {
            Write-Host "  [DRY-RUN] would create directory" -ForegroundColor Gray
        } else {
            New-Item -ItemType Directory -Path $GeminiCommands -Force | Out-Null
            Write-Host "  created directory" -ForegroundColor Gray
        }
    }

    $expected = $sourceSkills |
        Where-Object { $_.Name -like "source-command-*" } |
        ForEach-Object { $_.Name.Substring("source-command-".Length) } |
        Sort-Object

    $missing = @()
    foreach ($name in $expected) {
        $path = Join-Path $GeminiCommands "$name.toml"
        if (Test-Path $path) {
            Write-Host "  present: $name.toml" -ForegroundColor Gray
            continue
        }

        $content = New-GeminiCommandContent -CommandName $name
        if ($null -eq $content) {
            $missing += "$name.toml"
            Write-Host "  missing without generator: $name.toml" -ForegroundColor Red
            continue
        }

        if ($DryRun) {
            Write-Host "  [DRY-RUN] would create: $name.toml" -ForegroundColor Green
        } else {
            Write-Utf8NoBom -Path $path -Content ($content + "`n")
            Write-Host "  created: $name.toml" -ForegroundColor Green
        }
        $script:totalGeminiCreated++
    }

    if ($missing.Count -gt 0) {
        throw "[sync_skills] Gemini CLI command surface missing files: $($missing -join ', ')"
    }

    Write-Host "$prefix VERIFY PASS: Gemini CLI command surface aligned with source-command list" -ForegroundColor Green
    Write-Host ""
}

foreach ($target in $Targets) {
    Write-Host "$prefix 동기화 → $target" -ForegroundColor Yellow

    if (-not (Test-Path $target)) {
        if ($DryRun) {
            Write-Host "  [DRY-RUN] would create directory" -ForegroundColor Gray
        } else {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Write-Host "  created directory" -ForegroundColor Gray
        }
    }

    # 타겟에서 소스에 없는 스킬 제거 (orphan cleanup)
    $targetSkills = Get-ChildItem -Path $target -Directory -ErrorAction SilentlyContinue
    foreach ($t in $targetSkills) {
        $existsInSource = $sourceSkills | Where-Object { $_.Name -eq $t.Name }
        if (-not $existsInSource) {
            if ($DryRun) {
                Write-Host "  [DRY-RUN] would remove orphan: $($t.Name)" -ForegroundColor Red
            } else {
                Remove-Item -Path $t.FullName -Recurse -Force
                Write-Host "  removed orphan: $($t.Name)" -ForegroundColor Red
            }
            $totalRemoved++
        }
    }

    # 소스 스킬 복사 (덮어쓰기)
    foreach ($s in $sourceSkills) {
        $dest = Join-Path $target $s.Name

        if ($DryRun) {
            $needsUpdate = $false
            if (-not (Test-Path $dest)) {
                $needsUpdate = $true
                $reason = "new"
            } else {
                # 모든 파일 byte 비교
                $sourceFiles = Get-ChildItem -Path $s.FullName -Recurse -File
                foreach ($sf in $sourceFiles) {
                    $relPath = $sf.FullName.Substring($s.FullName.Length + 1)
                    $df = Join-Path $dest $relPath
                    if (-not (Test-Path $df)) {
                        $needsUpdate = $true
                        $reason = "missing $relPath"
                        break
                    }
                    $sourceHash = (Get-FileHash $sf.FullName -Algorithm SHA256).Hash
                    $destHash = (Get-FileHash $df -Algorithm SHA256).Hash
                    if ($sourceHash -ne $destHash) {
                        $needsUpdate = $true
                        $reason = "differs $relPath"
                        break
                    }
                }
            }

            if ($needsUpdate) {
                Write-Host "  [DRY-RUN] would copy: $($s.Name) ($reason)" -ForegroundColor Green
                $totalCopied++
            } else {
                Write-Host "  unchanged: $($s.Name)" -ForegroundColor Gray
            }
        } else {
            # 실제 복사 — 기존 디렉토리 제거 후 새로 복사 (clean mirror)
            if (Test-Path $dest) {
                Remove-Item -Path $dest -Recurse -Force
            }
            Copy-Item -Path $s.FullName -Destination $dest -Recurse -Force
            Write-Host "  copied: $($s.Name)" -ForegroundColor Green
            $totalCopied++
        }
    }
    Write-Host ""
}

Sync-CodexHookSurfaces
Sync-GeminiCommandSurface

# 검증 (DryRun 아닐 때만)
if (-not $DryRun) {
    $verifyPass = $true
    foreach ($target in $Targets) {
        $diff = Compare-Object -ReferenceObject (Get-ChildItem $Source -Recurse | Select-Object -ExpandProperty Name) `
                              -DifferenceObject (Get-ChildItem $target -Recurse | Select-Object -ExpandProperty Name) `
                              -SyncWindow 0 -ErrorAction SilentlyContinue
        if ($diff) {
            $verifyPass = $false
            Write-Host "[sync_skills] VERIFY FAIL: $target — diff exists" -ForegroundColor Red
        }
    }
    if ($verifyPass) {
        Write-Host "[sync_skills] VERIFY PASS: Codex 정본 + Antigravity 미러 동기화 완료" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "$prefix 요약: copied=$totalCopied removed_orphans=$totalRemoved gemini_created=$totalGeminiCreated" -ForegroundColor Cyan
