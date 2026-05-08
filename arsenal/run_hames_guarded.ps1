param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("PreflightWrite","PreflightEdit","FinalizeEdit","PreflightBash","VerifyFile","SystemCheck")]
    [string]$Mode,

    [string]$TargetFile = "",
    [string]$OldString = "",
    [string]$NewString = "",
    [string]$Command = ""
)

$HamesRoot = "{{HAMES_ROOT}}"
$Auditor = Join-Path $HamesRoot "arsenal\compliance_auditor.js"
$EditVerifier = Join-Path $HamesRoot "arsenal\verify_edit_surgery.js"
$TaskVerifier = Join-Path $HamesRoot "arsenal\verify_tasks.js"

function Invoke-NodeJsonGuard {
    param(
        [Parameter(Mandatory=$true)] [hashtable]$Payload,
        [Parameter(Mandatory=$true)] [string]$ScriptPath
    )

    $json = $Payload | ConvertTo-Json -Compress -Depth 10
    $json | node $ScriptPath
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Mode) {
    "PreflightWrite" {
        if (-not $TargetFile) { throw "TargetFile is required for PreflightWrite." }
        Invoke-NodeJsonGuard -Payload @{
            tool_name = "Write"
            tool_input = @{
                file_path = $TargetFile
            }
        } -ScriptPath $Auditor
        Write-Host "[HAMES GUARDED] PreflightWrite PASS"
    }

    "PreflightEdit" {
        if (-not $TargetFile) { throw "TargetFile is required for PreflightEdit." }
        if (-not $OldString) { throw "OldString is required for PreflightEdit." }
        Invoke-NodeJsonGuard -Payload @{
            tool_name = "Edit"
            tool_input = @{
                file_path = $TargetFile
                old_string = $OldString
                new_string = $NewString
            }
        } -ScriptPath $Auditor
        Write-Host "[HAMES GUARDED] PreflightEdit PASS"
    }

    "FinalizeEdit" {
        if (-not $TargetFile) { throw "TargetFile is required for FinalizeEdit." }
        if (-not $OldString) { throw "OldString is required for FinalizeEdit." }
        Invoke-NodeJsonGuard -Payload @{
            tool_name = "Edit"
            tool_input = @{
                file_path = $TargetFile
                old_string = $OldString
                new_string = $NewString
            }
        } -ScriptPath $EditVerifier

        node $TaskVerifier $TargetFile
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        Write-Host "[HAMES GUARDED] FinalizeEdit PASS"
    }

    "PreflightBash" {
        if (-not $Command) { throw "Command is required for PreflightBash." }
        Invoke-NodeJsonGuard -Payload @{
            tool_name = "Bash"
            tool_input = @{
                command = $Command
            }
        } -ScriptPath $Auditor
        Write-Host "[HAMES GUARDED] PreflightBash PASS"
    }

    "VerifyFile" {
        if (-not $TargetFile) { throw "TargetFile is required for VerifyFile." }
        node $TaskVerifier $TargetFile
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        Write-Host "[HAMES GUARDED] VerifyFile PASS"
    }

    "SystemCheck" {
        node $TaskVerifier --check-system
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        Write-Host "[HAMES GUARDED] SystemCheck PASS"
    }
}
