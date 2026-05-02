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
    Id = "nest-task2-feature"
    Repository = $repositoryDefinition.Name
    TaskKey = "task2-feature"
    Prompt = @"
Add a new `@Timeout(ms)` decorator for controller methods that automatically returns a 408 Request Timeout if the handler doesn't complete within the specified milliseconds. Implement it as a proper NestJS interceptor with decorator. Write the decorator, interceptor, and register it correctly.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
