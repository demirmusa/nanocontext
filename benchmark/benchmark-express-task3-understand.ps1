param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

$repositoryDefinition = @{
    Name = "express"
    Url = "https://github.com/expressjs/express.git"
    Language = "typescript"
    Include = @("lib/**/*.js", "test/**/*.js")
}

$taskDefinition = @{
    Id = "express-task3-understand"
    Repository = $repositoryDefinition.Name
    TaskKey = "task3-understand"
    Prompt = @"
How does Express's error handling work end-to-end? Find all the places where errors are caught, passed to `next(err)`, and ultimately handled. List every file and function involved in the error propagation chain.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
