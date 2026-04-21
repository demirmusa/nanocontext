param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common\Benchmark.Definitions.ps1")

$taskIds = Get-BenchmarkTaskIds

foreach ($taskId in $taskIds) {
    Write-Host "" -ForegroundColor Cyan
    Write-Host "=== Running $taskId ===" -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "run-benchmark.ps1") -TaskId $taskId -Model $Model
}
