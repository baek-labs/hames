<#
.SYNOPSIS
    Hames installation — Windows (PowerShell).

.DESCRIPTION
    Run once after cloning. Renders {{TOKEN}} placeholders in framework files,
    generates per-machine state files, and prepares the system for first use.

    Idempotent: safe to re-run. Skips already-rendered files.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/init.ps1
    powershell -ExecutionPolicy Bypass -File scripts/init.ps1 -CeoName "Jane Doe" -CeoEmail "jane@example.com"
    powershell -ExecutionPolicy Bypass -File scripts/init.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string]$CeoName = "",
    [string]$CeoEmail = "",
    [switch]$DryRun,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ── Resolve Hames root (script's parent directory) ──────────────────────────
$HamesRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HamesRootPosix = $HamesRoot -replace '\\', '/'
$HamesRootEscaped = $HamesRoot -replace '\\', '\\\\'

$prefix = if ($DryRun) { "[DRY-RUN]" } else { "[init]" }

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host " Hames installer (Windows)" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "$prefix Hames root: $HamesRoot"
Write-Host ""

# ── Step 1 — Collect identity tokens ────────────────────────────────────────
if (-not $CeoName -and -not $NonInteractive) {
    $CeoName = Read-Host "Your name (becomes {{CEO_NAME}} in framework files)"
}
if (-not $CeoEmail -and -not $NonInteractive) {
    $CeoEmail = Read-Host "Your email (optional, press Enter to skip)"
}

if (-not $CeoName) { $CeoName = "Hames Operator" }
if (-not $CeoEmail) { $CeoEmail = "operator@example.com" }

Write-Host ""
Write-Host "$prefix CEO_NAME:  $CeoName"
Write-Host "$prefix CEO_EMAIL: $CeoEmail"
Write-Host ""

# ── Step 2 — Token rendering ────────────────────────────────────────────────
$tokens = @(
    @{ from = '{{CEO_NAME}}';            to = $CeoName }
    @{ from = '{{CEO_EMAIL}}';           to = $CeoEmail }
    @{ from = '{{HAMES_ROOT_POSIX}}';    to = $HamesRootPosix }
    @{ from = '{{HAMES_ROOT_ESCAPED}}';  to = $HamesRootEscaped }
    @{ from = '{{HAMES_ROOT}}';          to = $HamesRoot }
)

$ext = @('.md','.json','.toml','.js','.py','.ps1','.sh','.txt','.yml','.yaml','.cjs','.mjs','.template','.cursorrules','.gitattributes','.gitignore')

$files = Get-ChildItem -Path $HamesRoot -Recurse -File -Force `
    | Where-Object {
        $_.FullName -notlike "*\.git\*" -and
        $_.FullName -notlike "*\node_modules\*" -and
        ($ext -contains $_.Extension -or $_.Name -match '^\.(cursorrules|gitignore|gitattributes)$')
    }

Write-Host "$prefix Rendering tokens in $($files.Count) text files..." -ForegroundColor Cyan
$rendered = 0
$totalReplacements = 0
$renderedRelPaths = @()
foreach ($f in $files) {
    $content = Get-Content -Path $f.FullName -Raw -Encoding UTF8
    $orig = $content
    foreach ($t in $tokens) {
        $count = ([regex]::Matches($content, [regex]::Escape($t.from))).Count
        if ($count -gt 0) {
            $content = $content.Replace($t.from, $t.to)
            $totalReplacements += $count
        }
    }
    if ($content -ne $orig) {
        $rendered++
        $relPath = $f.FullName.Substring($HamesRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        $renderedRelPaths += $relPath
        if (-not $DryRun) {
            [System.IO.File]::WriteAllText($f.FullName, $content, [System.Text.UTF8Encoding]::new($false))
        }
    }
}
Write-Host "$prefix   files rendered: $rendered  (replacements: $totalReplacements)" -ForegroundColor Green

if (-not $DryRun -and $renderedRelPaths.Count -gt 0 -and (Test-Path (Join-Path $HamesRoot ".git"))) {
    $tracked = @{}
    & git -C $HamesRoot ls-files | ForEach-Object { $tracked[$_] = $true }
    $trackedRendered = $renderedRelPaths | Where-Object { $tracked.ContainsKey($_) }
    if ($trackedRendered.Count -gt 0) {
        & git -C $HamesRoot update-index --skip-worktree -- $trackedRendered
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$prefix marked rendered framework files as local-only for clean git status" -ForegroundColor Green
        } else {
            Write-Host "$prefix could not mark rendered files local-only (non-fatal)" -ForegroundColor Yellow
        }
    }
}

# ── Step 3 — workspaces/_scaffold/CLAUDE.md.template → leave as-is ──────────
# Users copy this when creating their own workspace; init does not pre-render.

# ── Step 4 — Per-machine state files ────────────────────────────────────────
$lockFile = Join-Path $HamesRoot ".claude\.workspace_lock"
if (-not (Test-Path $lockFile)) {
    if ($DryRun) {
        Write-Host "$prefix would create $lockFile" -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Path (Split-Path $lockFile) -Force | Out-Null
        [System.IO.File]::WriteAllText($lockFile, '{"workspace": null, "locked": false}', [System.Text.UTF8Encoding]::new($false))
        Write-Host "$prefix created .claude/.workspace_lock (lock OFF)" -ForegroundColor Green
    }
}

$pathsFile = Join-Path $HamesRoot ".claude\workspace_paths.json"
if (-not (Test-Path $pathsFile)) {
    if ($DryRun) {
        Write-Host "$prefix would create $pathsFile" -ForegroundColor Yellow
    } else {
        $paths = @{
            schema_version = "paths-1.0"
            hames_root = $HamesRoot
            workspaces = @{}
            _comment = "Auto-generated by init.ps1. Add entries when you create workspaces under workspaces/."
        }
        $json = $paths | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($pathsFile, $json, [System.Text.UTF8Encoding]::new($false))
        Write-Host "$prefix created .claude/workspace_paths.json" -ForegroundColor Green
    }
}

# ── Step 5 — .env from .env.example if absent ───────────────────────────────
$envFile = Join-Path $HamesRoot "arsenal\.env"
$envExample = Join-Path $HamesRoot "arsenal\.env.example"
if ((Test-Path $envExample) -and -not (Test-Path $envFile)) {
    if ($DryRun) {
        Write-Host "$prefix would copy arsenal/.env.example -> arsenal/.env" -ForegroundColor Yellow
    } else {
        Copy-Item $envExample $envFile
        Write-Host "$prefix copied arsenal/.env.example -> arsenal/.env" -ForegroundColor Green
        Write-Host "$prefix   ⚠  Fill arsenal/.env with your API keys (file is gitignored)" -ForegroundColor Yellow
    }
}

# ── Step 6 — npm install in arsenal (if package.json present) ───────────────
$arsenalPkg = Join-Path $HamesRoot "arsenal\package.json"
if (Test-Path $arsenalPkg) {
    if ($DryRun) {
        Write-Host "$prefix would npm install in arsenal/" -ForegroundColor Yellow
    } else {
        Write-Host "$prefix npm install in arsenal/..." -ForegroundColor Cyan
        Push-Location (Join-Path $HamesRoot "arsenal")
        $oldEap = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            if (Test-Path (Join-Path (Get-Location) "package-lock.json")) {
                & npm ci --no-audit --no-fund --loglevel=error
            } else {
                & npm install --no-audit --no-fund --loglevel=error
            }
            $npmExit = $LASTEXITCODE
            if ($npmExit -eq 0) {
                Write-Host "$prefix   npm dependencies OK" -ForegroundColor Green
            } else {
                Write-Host "$prefix   npm dependencies skipped or failed (optional dependencies unavailable, exit $npmExit)" -ForegroundColor Yellow
            }
        } finally {
            $ErrorActionPreference = $oldEap
            Pop-Location
        }
    }
}

# ── Step 7 — Run verify_install.js ──────────────────────────────────────────
$verifyScript = Join-Path $HamesRoot "scripts\verify_install.js"
if (Test-Path $verifyScript) {
    if ($DryRun) {
        Write-Host "$prefix would run scripts/verify_install.js" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "$prefix running install verification..." -ForegroundColor Cyan
        & node $verifyScript
        $verifyExit = $LASTEXITCODE
        if ($verifyExit -ne 0) {
            Write-Host "$prefix VERIFICATION FAILED (exit $verifyExit). Inspect output above." -ForegroundColor Red
            exit $verifyExit
        }
    }
}

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Green
Write-Host " Hames install complete." -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit arsenal/.env with your API keys (optional)"
Write-Host "  2. In an AI client (Claude Code / Codex / Gemini CLI), open this directory"
Write-Host "  3. Type: HamesSystem 적용  (or any first message) — defense lines activate"
Write-Host "  4. Try: /doctor  — system integrity check"
Write-Host ""

exit 0
