param(
    [Parameter(Mandatory=$true)][string]$HandoffId,
    [Parameter(Mandatory=$true)][string]$TargetModel,
    [Parameter(Mandatory=$true)][string]$SourceModel,
    [Parameter(Mandatory=$true)][string]$SourceWorkspace,
    [string]$TaskSummary  = "(fill in)",
    [string]$CurrentState = "(fill in)",
    [string]$NextStep     = "(fill in)"
)

$HamesRoot   = "{{HAMES_ROOT}}"
$InboxDir    = Join-Path $HamesRoot "Anti\999_AI_Communication\_Inbox"

$fileName   = "Handoff_$HandoffId.md"
$outputFile = Join-Path $InboxDir $fileName

function Resolve-WorkspaceMap {
    param(
        [string]$HamesRoot,
        [string]$SourceWorkspace
    )

    $rootPath = [System.IO.Path]::GetFullPath($HamesRoot)
    $workspaceInput = $SourceWorkspace.Trim()

    if ([string]::IsNullOrWhiteSpace($workspaceInput)) {
        return @("CLAUDE.md")
    }

    $workspacePath = $workspaceInput
    if (-not [System.IO.Path]::IsPathRooted($workspacePath)) {
        $workspacePath = Join-Path $rootPath $workspacePath
    }
    $workspacePath = [System.IO.Path]::GetFullPath($workspacePath)

    if ($workspacePath -eq $rootPath) {
        return @("CLAUDE.md")
    }

    $rootWithSep = $rootPath.TrimEnd('\') + '\'
    if (-not $workspacePath.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
        return @("CLAUDE.md")
    }

    $relativeWorkspace = $workspacePath.Substring($rootWithSep.Length).Replace('\', '/').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($relativeWorkspace)) {
        return @("CLAUDE.md")
    }

    $map = @("CLAUDE.md")
    foreach ($suffix in @("CLAUDE.md", "_Master", "_Index.md")) {
        $candidateRelative = "$relativeWorkspace/$suffix"
        $candidatePath = Join-Path $rootPath ($candidateRelative.Replace('/', '\'))
        if (Test-Path $candidatePath) {
            $map += $candidateRelative
        }
    }

    return $map
}

$loadOrderText = (Resolve-WorkspaceMap -HamesRoot $HamesRoot -SourceWorkspace $SourceWorkspace | ForEach-Object { "- $_" }) -join "`n"

$createdAt = (Get-Date -Format "yyyy-MM-dd HH:mm")

$content = @"
---
handoff_id: "$HandoffId"
source_model: "$SourceModel"
target_model: "$TargetModel"
source_workspace: "$SourceWorkspace"
created_at: "$createdAt"
status: "READY"
---

## Task

$TaskSummary

## Workspace Map

$loadOrderText

## Current State

$CurrentState

## Constraints

- Final outputs must remain in the source workspace, not AI_COMM.
- AI_COMM is handoff-only, not execution workspace.
- Fixed load order: workspace CLAUDE.md -> _Master -> _Index.md -> task files.
- Run verifier before declaring any output complete.

## Referenced Files

- None.

## Open Questions

- None.

## Next Step

$NextStep
"@

Set-Content -Path $outputFile -Value $content -Encoding UTF8

Write-Host ""
Write-Host "=== HANDOFF CREATED ===" -ForegroundColor Green
Write-Host "  File   : $outputFile"
Write-Host "  From   : $SourceModel"
Write-Host "  To     : $TargetModel"
Write-Host ""
Write-Host "  Validate with:"
Write-Host "  .\validate_handoff.ps1 -HandoffFile ""$outputFile"""
Write-Host ""
