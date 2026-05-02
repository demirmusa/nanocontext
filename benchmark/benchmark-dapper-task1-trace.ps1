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
    Id = "dapper-task1-trace"
    Repository = $repositoryDefinition.Name
    TaskKey = "task1-trace"
    Prompt = @"
Trace how `connection.QueryAsync<User>("SELECT * FROM Users WHERE Id = @Id", new { Id = 1 })` works internally. From the extension method call through SQL parameter binding, command execution, and object mapping back to a `User` instance. Map every class and method with file locations.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
