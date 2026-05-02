param(
    [string]$Model
)

$ErrorActionPreference = "Stop"

$repositoryDefinition = @{
    Name = "nest"
    Url = "https://github.com/nestjs/nest.git"
    Language = "typescript"
    Include = @("packages/**/*.ts", "integration/**/*.ts", "sample/**/*.ts")
}

$taskDefinition = @{
    Id = "nest-task1-trace"
    Repository = $repositoryDefinition.Name
    TaskKey = "task1-trace"
    Prompt = @"
Trace how a `@Get()` decorated controller method receives a request. Start from the HTTP server receiving the request, through the NestJS routing layer, middleware, guards, interceptors, pipes, and finally the controller method. Map every class and method involved with file locations.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
