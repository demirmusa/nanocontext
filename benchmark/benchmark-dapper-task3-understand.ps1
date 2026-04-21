param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "run-benchmark.ps1") -TaskId "dapper-task3-understand" -Model $Model
