param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "run-benchmark.ps1") -TaskId "nest-task2-feature" -Model $Model
