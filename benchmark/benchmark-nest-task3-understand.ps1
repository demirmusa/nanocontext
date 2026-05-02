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
    Id = "nest-task3-understand"
    Repository = $repositoryDefinition.Name
    TaskKey = "task3-understand"
    Prompt = @"
Explain NestJS's dependency injection container implementation. How does `@Injectable()` register a class? How does the container resolve circular dependencies? Find the actual source files that implement the DI container, the resolution algorithm, and the scope handling (DEFAULT, REQUEST, TRANSIENT).
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
