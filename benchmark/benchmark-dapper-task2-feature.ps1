param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

$repositoryDefinition = @{
    Name = "Dapper"
    Url = "https://github.com/DapperLib/Dapper.git"
    Language = "csharp"
    Include = @("Dapper/**/*.cs", "tests/**/*.cs")
}

$taskDefinition = @{
    Id = "dapper-task2-feature"
    Repository = $repositoryDefinition.Name
    TaskKey = "task2-feature"
    Prompt = @"
Add a built-in `DateOnly` and `TimeOnly` type handler to Dapper so that these types work automatically without users having to register custom handlers. Implement the handlers and register them in the default type handler map.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
