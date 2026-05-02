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
    Id = "eshop-task3-understand"
    Repository = $repositoryDefinition.Name
    TaskKey = "task3-understand"
    Prompt = @"
How does eShop implement the saga/process manager pattern for order processing? Find all integration events, event handlers, and state transitions involved in taking an order from 'submitted' to 'shipped'. Map the entire event flow across all microservices.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
