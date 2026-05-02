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
    Id = "express-task1-trace"
    Repository = $repositoryDefinition.Name
    TaskKey = "task1-trace"
    Prompt = @"
Express's `res.redirect()` method handles both relative and absolute URLs. Trace the full code path of `res.redirect('/users')` from the moment it's called to the final HTTP response being sent. Show me every function involved, what file it's in, and what each step does.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
