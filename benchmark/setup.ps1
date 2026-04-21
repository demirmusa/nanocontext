# NanoContext Benchmark - Project Setup Script
# Structure: clean/<project>/<task>  and  nanocontext/<project>/<task>
#
# Flow:
#   1. Clone repos into _clones/
#   2. Copy into clean/<project>/<task> folders + write TASK.md
#   3. Copy into temp nanocontext/<project>/ folders, run nc init + nc scan
#   4. Copy indexed project into nanocontext/<project>/<task> folders + write TASK.md

$ErrorActionPreference = "Stop"
$BenchmarkDir = Join-Path $PSScriptRoot "repos"

$Repos = @(
    @{
        Name = "express"
        Url  = "https://github.com/expressjs/express.git"
        Lang = "javascript"
        Include = @("lib/**/*.js", "lib/**/*.ts")
    }
    @{
        Name = "nest"
        Url  = "https://github.com/nestjs/nest.git"
        Lang = "typescript"
        Include = @("packages/**/*.ts")
    }
    @{
        Name = "Dapper"
        Url  = "https://github.com/DapperLib/Dapper.git"
        Lang = "csharp"
        Include = @("Dapper/**/*.cs")
    }
    @{
        Name = "eShop"
        Url  = "https://github.com/dotnet/eShop.git"
        Lang = "csharp"
        Include = @("src/**/*.cs")
    }
)

# Task prompts per project
$TaskPrompts = @{
    "express" = @{
        "task1-trace" = @"
Express's ``res.redirect()`` method handles both relative and absolute URLs. Trace the full code path of ``res.redirect('/users')`` from the moment it's called to the final HTTP response being sent. Show me every function involved, what file it's in, and what each step does.
"@
        "task2-feature" = @"
Add a ``req.startedAt`` property that records ``Date.now()`` when the request begins, and a ``res.elapsed()`` method that returns the milliseconds since ``req.startedAt``. Implement this as built-in middleware that runs automatically for every request. Modify the necessary source files.
"@
        "task3-understand" = @"
How does Express's error handling work end-to-end? Find all the places where errors are caught, passed to ``next(err)``, and ultimately handled. List every file and function involved in the error propagation chain.
"@
    }
    "nest" = @{
        "task1-trace" = @"
Trace how a ``@Get()`` decorated controller method receives a request. Start from the HTTP server receiving the request, through the NestJS routing layer, middleware, guards, interceptors, pipes, and finally the controller method. Map every class and method involved with file locations.
"@
        "task2-feature" = @"
Add a new ``@Timeout(ms)`` decorator for controller methods that automatically returns a 408 Request Timeout if the handler doesn't complete within the specified milliseconds. Implement it as a proper NestJS interceptor with decorator. Write the decorator, interceptor, and register it correctly.
"@
        "task3-understand" = @"
Explain NestJS's dependency injection container implementation. How does ``@Injectable()`` register a class? How does the container resolve circular dependencies? Find the actual source files that implement the DI container, the resolution algorithm, and the scope handling (DEFAULT, REQUEST, TRANSIENT).
"@
    }
    "Dapper" = @{
        "task1-trace" = @"
Trace how ``connection.QueryAsync<User>("SELECT * FROM Users WHERE Id = @Id", new { Id = 1 })`` works internally. From the extension method call through SQL parameter binding, command execution, and object mapping back to a ``User`` instance. Map every class and method with file locations.
"@
        "task2-feature" = @"
Add a built-in ``DateOnly`` and ``TimeOnly`` type handler to Dapper so that these types work automatically without users having to register custom handlers. Implement the handlers and register them in the default type handler map.
"@
        "task3-understand" = @"
How does Dapper's object mapping work? When a SQL query returns columns, how does Dapper map them to C# object properties? Find the IL generation / emit code that creates the mapping function. Map every class and method involved with file locations.
"@
    }
    "eShop" = @{
        "task1-trace" = @"
Trace the complete flow of placing an order in eShop. Start from the API endpoint that receives the order request, through validation, domain events, integration events, and database persistence. Map every service, handler, and event involved with file locations.
"@
        "task2-feature" = @"
Add a discount coupon feature to the Basket service. A coupon has a code (string) and a percentage discount (decimal). Add: 1) A coupon entity, 2) An endpoint to apply a coupon code to a basket, 3) Validation that the coupon exists and isn't expired, 4) Apply the discount when calculating basket totals.
"@
        "task3-understand" = @"
How does eShop implement the saga/process manager pattern for order processing? Find all integration events, event handlers, and state transitions involved in taking an order from 'submitted' to 'shipped'. Map the entire event flow across all microservices.
"@
    }
}

$Tasks = @("task1-trace", "task2-feature", "task3-understand")

function Write-TaskMd {
    param([string]$Dir, [string]$ProjectName, [string]$TaskName, [string]$Prompt)
    $taskLabels = @{
        "task1-trace"      = "Task 1 — Code Trace (Read-Heavy)"
        "task2-feature"    = "Task 2 — Feature Implementation (Read + Write)"
        "task3-understand" = "Task 3 — Cross-Cutting Understanding"
    }
    $label = $taskLabels[$TaskName]
    $md = @"
# $label

**Project:** $ProjectName

## Prompt

$Prompt

## Results

| Run | Input Tokens | Output Tokens | Total Tokens | File Reads | NC Tool Calls | Success (0/0.5/1) | Notes |
|-----|-------------|---------------|--------------|------------|---------------|-------------------|-------|
| 1   |             |               |              |            |               |                   |       |
| 2   |             |               |              |            |               |                   |       |
"@
    Set-Content -Path (Join-Path $Dir "TASK.md") -Value $md -Encoding UTF8
}

# ============================================================
# STEP 1: Clone repos and remove .git
# ============================================================
Write-Host "`n=== STEP 1: Cloning repos ===" -ForegroundColor Cyan

$cloneDir = Join-Path $BenchmarkDir "_clones"
if (-not (Test-Path $cloneDir)) {
    New-Item -ItemType Directory -Path $cloneDir -Force | Out-Null
}

foreach ($repo in $Repos) {
    $clonePath = Join-Path $cloneDir $repo.Name
    if (-not (Test-Path $clonePath)) {
        Write-Host "  Cloning $($repo.Name)..." -ForegroundColor Yellow
        git clone --depth 1 $repo.Url $clonePath
        # Remove .git immediately after clone so copies are clean
        $gitDir = Join-Path $clonePath ".git"
        if (Test-Path $gitDir) {
            $oldProgress = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            Remove-Item $gitDir -Recurse -Force
            $ProgressPreference = $oldProgress
        }
    } else {
        Write-Host "  $($repo.Name) already cloned." -ForegroundColor DarkGray
    }
}

# ============================================================
# STEP 2: Create clean/<project>/<task> folders
# ============================================================
Write-Host "`n=== STEP 2: Creating clean/ folders ===" -ForegroundColor Cyan

foreach ($repo in $Repos) {
    foreach ($task in $Tasks) {
        $targetDir = Join-Path $BenchmarkDir "clean" $repo.Name $task
        if (Test-Path $targetDir) {
            Write-Host "  clean/$($repo.Name)/$task already exists." -ForegroundColor DarkGray
            continue
        }
        Write-Host "  Copying -> clean/$($repo.Name)/$task" -ForegroundColor Yellow
        Copy-Item -Path (Join-Path $cloneDir $repo.Name) -Destination $targetDir -Recurse -Force
        Write-TaskMd -Dir $targetDir -ProjectName $repo.Name -TaskName $task -Prompt $TaskPrompts[$repo.Name][$task]
    }
}

# ============================================================
# STEP 3: Init NanoContext on each project (once per project)
# ============================================================
Write-Host "`n=== STEP 3: NanoContext init + scan (per project) ===" -ForegroundColor Cyan

$ncTempDir = Join-Path $BenchmarkDir "_nc_indexed"
if (-not (Test-Path $ncTempDir)) {
    New-Item -ItemType Directory -Path $ncTempDir -Force | Out-Null
}

foreach ($repo in $Repos) {
    $indexedPath = Join-Path $ncTempDir $repo.Name
    
    if (Test-Path (Join-Path $indexedPath ".nanocontext")) {
        Write-Host "  $($repo.Name) already indexed." -ForegroundColor DarkGray
        continue
    }

    # Copy fresh clone
    if (Test-Path $indexedPath) { Remove-Item $indexedPath -Recurse -Force }
    Copy-Item -Path (Join-Path $cloneDir $repo.Name) -Destination $indexedPath -Recurse -Force

    Write-Host "`n  ── $($repo.Name) ──" -ForegroundColor Yellow
    Write-Host "  Running nc init (interactive)..." -ForegroundColor Yellow
    Push-Location $indexedPath
    & nc init
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: nc init failed for $($repo.Name)" -ForegroundColor Red
        Pop-Location
        continue
    }

    Write-Host "  Scanning $($repo.Name)..." -ForegroundColor Yellow
    & nc scan
    $scanExit = $LASTEXITCODE

    if ($scanExit -ne 0) {
        Write-Host "  WARNING: nc scan exited with code $scanExit for $($repo.Name)" -ForegroundColor Red
    } else {
        & nc status
    }
    Pop-Location
}

# ============================================================
# STEP 4: Copy indexed projects into nanocontext/<project>/<task>
# ============================================================
Write-Host "`n=== STEP 4: Creating nanocontext/ folders (with index) ===" -ForegroundColor Cyan

foreach ($repo in $Repos) {
    foreach ($task in $Tasks) {
        $targetDir = Join-Path $BenchmarkDir "nanocontext" $repo.Name $task
        if (Test-Path $targetDir) {
            Write-Host "  nanocontext/$($repo.Name)/$task already exists." -ForegroundColor DarkGray
            continue
        }
        Write-Host "  Copying -> nanocontext/$($repo.Name)/$task" -ForegroundColor Yellow
        $indexedPath = Join-Path $ncTempDir $repo.Name
        Copy-Item -Path $indexedPath -Destination $targetDir -Recurse -Force
        Write-TaskMd -Dir $targetDir -ProjectName $repo.Name -TaskName $task -Prompt $TaskPrompts[$repo.Name][$task]
    }
}

# ============================================================
# SUMMARY
# ============================================================
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " Setup Complete" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Folder structure:" -ForegroundColor Cyan
foreach ($condition in @("clean", "nanocontext")) {
    Write-Host "  $condition/" -ForegroundColor White
    foreach ($repo in $Repos) {
        Write-Host "    $($repo.Name)/" -ForegroundColor White
        foreach ($task in $Tasks) {
            $dir = Join-Path $BenchmarkDir $condition $repo.Name $task
            $marker = if (Test-Path $dir) { "OK" } else { "MISSING" }
            $color = if ($marker -eq "OK") { "Green" } else { "Red" }
            Write-Host "      $task [$marker]" -ForegroundColor $color
        }
    }
}

$totalFolders = 2 * $Repos.Count * $Tasks.Count
Write-Host "`nTotal test folders: $totalFolders" -ForegroundColor Green
Write-Host "`nEach folder contains a TASK.md with the prompt and results table."
Write-Host "clean/ folders have NO NanoContext. nanocontext/ folders are pre-indexed."
Write-Host "`nFollow BENCHMARK.md for test execution." -ForegroundColor Yellow
