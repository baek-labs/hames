param(
    [Parameter(Mandatory=$true)][string]$HandoffFile
)

if (-not (Test-Path $HandoffFile)) {
    Write-Host "[ERROR] File not found: $HandoffFile" -ForegroundColor Red
    exit 1
}

$content = Get-Content $HandoffFile -Raw
$errors  = @()

# --- Frontmatter field checks ---
if ($content -notmatch 'handoff_id:\s*"[^"]+"')        { $errors += "Missing or empty: handoff_id" }
if ($content -notmatch 'source_model:\s*"[^"]+"')       { $errors += "Missing or empty: source_model" }
if ($content -notmatch 'target_model:\s*"[^"]+"')       { $errors += "Missing or empty: target_model" }
if ($content -notmatch 'source_workspace:\s*"[^"]+"')   { $errors += "Missing or empty: source_workspace" }
if ($content -notmatch 'status:\s*"READY"')             { $errors += "status must be READY" }

# --- Required section checks ---
$requiredSections = @("## Task", "## Current State", "## Next Step", "## Workspace Map")
foreach ($section in $requiredSections) {
    if ($content -notmatch [regex]::Escape($section)) {
        $errors += "Missing section: $section"
    }
}

# --- Section content checks (not just placeholder) ---
$placeholders = @("(fill in)", "(add relevant file paths here)", "(add open questions here)")
foreach ($ph in $placeholders) {
    if ($content -match [regex]::Escape($ph)) {
        $errors += "Unfilled placeholder found: $ph"
    }
}

# --- Print result ---
Write-Host ""
Write-Host "=== HANDOFF VALIDATION ===" -ForegroundColor Cyan
Write-Host "  File: $(Split-Path $HandoffFile -Leaf)"
Write-Host ""

if ($errors.Count -eq 0) {
    Write-Host "  Result : PASS" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Ready to send to target model."
    Write-Host ""
    exit 0
} else {
    Write-Host "  Result : FAIL" -ForegroundColor Red
    Write-Host ""
    foreach ($err in $errors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
    Write-Host ""
    exit 1
}
