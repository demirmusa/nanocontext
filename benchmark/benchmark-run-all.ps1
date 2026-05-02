param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

$taskScripts = Get-ChildItem -LiteralPath $PSScriptRoot -Filter "benchmark-*-task*.ps1" |
    Sort-Object Name

foreach ($taskScript in $taskScripts) {
    Write-Host "" -ForegroundColor Cyan
    Write-Host "=== Running $($taskScript.BaseName) ===" -ForegroundColor Cyan
    & $taskScript.FullName -Model $Model
}
