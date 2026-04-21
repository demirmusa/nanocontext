param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "run-benchmark.ps1") -TaskId "nest-task3-understand" -Model $Model
