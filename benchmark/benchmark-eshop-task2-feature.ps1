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
    Id = "eshop-task2-feature"
    Repository = $repositoryDefinition.Name
    TaskKey = "task2-feature"
    Prompt = @"
Add a discount coupon feature to the Basket service. A coupon has a code (string) and a percentage discount (decimal). Add: 1) A coupon entity, 2) An endpoint to apply a coupon code to a basket, 3) Validation that the coupon exists and isn't expired, 4) Apply the discount when calculating basket totals.
"@
}

. (Join-Path $PSScriptRoot "common\Benchmark.Common.ps1")

Invoke-BenchmarkRun -TaskDefinition $taskDefinition -RepositoryDefinition $repositoryDefinition -Model $Model | Out-Null
