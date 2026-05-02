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
    Id = "dapper-task3-understand"
    Repository = $repositoryDefinition.Name
    TaskKey = "task3-understand"
    Prompt = @"
How does Dapper's object mapping work? When a SQL query returns columns, how does Dapper map them to C# object properties? Find the IL generation / emit code that creates the mapping function. Map every class and method involved with file locations.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
