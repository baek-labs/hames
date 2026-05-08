# Hames PowerShell UTF-8 bootstrap.
# Use this before Korean/emoji-heavy shell output on Windows PowerShell.

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
    chcp.com 65001 > $null
} catch {
    # Non-fatal. Encoding objects below still reduce mojibake risk.
}

[Console]::InputEncoding  = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding           = $Utf8NoBom

$env:PYTHONIOENCODING = "utf-8"
$env:HAMES_UTF8_READY = "1"
