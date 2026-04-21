param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "run-benchmark.ps1") -TaskId "express-task2-feature" -Model $Model
