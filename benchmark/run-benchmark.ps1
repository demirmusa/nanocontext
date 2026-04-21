param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [string]$Model
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common\Benchmark.Definitions.ps1")
. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskId $TaskId -Model $Model | Out-Null
