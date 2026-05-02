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
    Id = "express-task2-feature"
    Repository = $repositoryDefinition.Name
    TaskKey = "task2-feature"
    Prompt = @"
Add a `req.startedAt` property that records `Date.now()` when the request begins, and a `res.elapsed()` method that returns the milliseconds since `req.startedAt`. Implement this as built-in middleware that runs automatically for every request. Modify the necessary source files.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
