param(
    [Parameter(Mandatory=$true)][string]$HandoffFile
)

$HamesRoot  = "{{HAMES_ROOT}}"
$ArchiveDir = Join-Path $HamesRoot "Anti\999_AI_Communication\_Archive"

if (-not (Test-Path $HandoffFile)) {
    Write-Host "[ERROR] File not found: $HandoffFile" -ForegroundColor Red
    exit 1
}

$fileName = Split-Path $HandoffFile -Leaf
$dest     = Join-Path $ArchiveDir $fileName

if (Test-Path $dest) {
    Write-Host "[ERROR] Archive already contains: $fileName" -ForegroundColor Red
    Write-Host "        Rename the file before archiving."
    exit 1
}

Move-Item -Path $HandoffFile -Destination $dest

Write-Host ""
Write-Host "=== HANDOFF CLOSED ===" -ForegroundColor Green
Write-Host "  Archived : $dest"
Write-Host ""
