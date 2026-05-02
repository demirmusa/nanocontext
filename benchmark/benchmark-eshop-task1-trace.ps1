param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

$repositoryDefinition = @{
    Name = "eShop"
    Url = "https://github.com/dotnet/eShop.git"
    Language = "csharp"
    Include = @("src/**/*.cs")
}

$taskDefinition = @{
    Id = "eshop-task1-trace"
    Repository = $repositoryDefinition.Name
    TaskKey = "task1-trace"
    Prompt = @"
Trace the complete flow of placing an order in eShop. Start from the API endpoint that receives the order request, through validation, domain events, integration events, and database persistence. Map every service, handler, and event involved with file locations.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
