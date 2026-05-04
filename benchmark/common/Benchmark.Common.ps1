Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

function Get-BenchmarkRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-RepositoryRoot {
    return Split-Path -Parent (Get-BenchmarkRoot)
}

function Get-BenchmarkRunsRoot {
    $runsRoot = Join-Path (Get-BenchmarkRoot) "runs"
    New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
    return $runsRoot
}

function Get-BenchmarkReposRoot {
    $reposRoot = Join-Path (Get-BenchmarkRoot) "repos"
    New-Item -ItemType Directory -Path $reposRoot -Force | Out-Null
    return $reposRoot
}

function Get-BenchmarkEnvPath {
    return Join-Path (Get-BenchmarkRoot) ".env"
}

function Import-BenchmarkEnv {
    $envPath = Get-BenchmarkEnvPath
    if (-not (Test-Path $envPath)) {
        return
    }

    foreach ($line in (Get-Content -LiteralPath $envPath)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
            continue
        }

        $parts = $line -split '=', 2
        if ($parts.Length -ne 2) {
            continue
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Get-BenchmarkEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$DefaultValue,
        [switch]$Required
    )

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
    }

    if ($Required) {
        throw "$Name is missing. Set it in benchmark/.env before running benchmark scripts."
    }

    return $DefaultValue
}

function Get-BenchmarkCloneRoot {
    $cloneRoot = Join-Path (Get-BenchmarkReposRoot) "_clones"
    New-Item -ItemType Directory -Path $cloneRoot -Force | Out-Null
    return $cloneRoot
}

function Get-BenchmarkIndexedRoot {
    Import-BenchmarkEnv
    $embeddingProvider = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_PROVIDER' -DefaultValue 'openai'
    $embeddingModel = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_MODEL' -DefaultValue 'text-embedding-3-small'
    $cacheKey = Get-BenchmarkCacheKey -Parts @($embeddingProvider, $embeddingModel)
    $indexedRoot = Join-Path (Get-BenchmarkReposRoot) "_nc_indexed_$cacheKey"
    New-Item -ItemType Directory -Path $indexedRoot -Force | Out-Null
    return $indexedRoot
}

function Get-BenchmarkCacheKey {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Parts
    )

    $joined = ($Parts | ForEach-Object {
        ([string]$_).ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    }) -join '-'

    return $joined.Trim('-')
}

function Resolve-BenchmarkInitSettings {
    Import-BenchmarkEnv

    $requestedMode = (Get-BenchmarkEnvValue -Name 'NC_INIT_MODE' -DefaultValue 'cli').ToLowerInvariant()
    $agentsRaw = Get-BenchmarkEnvValue -Name 'NC_INIT_AGENTS' -DefaultValue 'codex'
    $agents = @(
        $agentsRaw.Split(',', [System.StringSplitOptions]::RemoveEmptyEntries) |
            ForEach-Object { $_.Trim().ToLowerInvariant() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    return @{
        Mode = $requestedMode
        Agents = $agents
    }
}

function Resolve-BenchmarkCodexExecSettings {
    $initSettings = Resolve-BenchmarkInitSettings
    if ($initSettings.Mode -eq 'cli' -and (@($initSettings.Agents) -contains 'codex')) {
        return @{
            UseDangerouslyBypass = $true
        }
    }

    return @{
        UseDangerouslyBypass = $false
    }
}

function Resolve-BenchmarkCodexRunModel {
    param(
        [string]$Model
    )

    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        return $Model
    }

    Import-BenchmarkEnv
    return Get-BenchmarkEnvValue -Name 'CODEX_RUN_MODEL' -DefaultValue $null
}

function Get-BenchmarkAgentInstruction {
    return @"
Benchmark constraint:
- Do not run tests, builds, package managers, linters, formatters, dev servers, database commands, or any other command that executes project code.
- You may inspect files, search the repository, and edit source files needed for the task.
- In your final answer, describe the validation you would run, but do not run it.
"@
}

function Get-BenchmarkExecutionPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskPrompt
    )

    return "$(Get-BenchmarkAgentInstruction)`n`nTask:`n$TaskPrompt"
}

function Test-BenchmarkAgentSetup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath
    )

    $settings = Resolve-BenchmarkInitSettings
    $agents = @($settings.Agents)
    $mode = $settings.Mode

    if (@($agents) -contains 'codex') {
        $agentDocPath = Join-Path $WorkspacePath "AGENTS.md"
        if (-not (Test-Path $agentDocPath)) {
            return $false
        }

        $agentDocContent = Get-Content -LiteralPath $agentDocPath -Raw
        $expectedPhrase = if ($mode -eq 'mcp') { "## NanoContext MCP" } else { "## NanoContext CLI" }
        if ($agentDocContent -notmatch [regex]::Escape($expectedPhrase)) {
            return $false
        }

        $codexConfigPath = Join-Path $WorkspacePath ".codex\config.toml"
        if ($mode -eq 'mcp') {
            if (-not (Test-Path $codexConfigPath)) {
                return $false
            }
        } elseif (Test-Path $codexConfigPath) {
            return $false
        }
    }

    return $true
}

function Get-NanoContextCli {
    $repoRoot = Get-RepositoryRoot
    $distCli = Join-Path $repoRoot "dist\cli\index.js"
    if (-not (Test-Path $distCli)) {
        throw "NanoContext CLI build output is missing at $distCli. Run npm run build first."
    }

    return @{
        Command = "node"
        Args = @($distCli)
        DistCliPath = $distCli
    }
}

function New-BenchmarkRunContext {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TaskDefinition
    )

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $guid = [Guid]::NewGuid().ToString("N")
    $runId = "$timestamp-$guid-$($TaskDefinition.Id)"
    $runRoot = Join-Path (Get-BenchmarkRunsRoot) $runId
    $logsPath = Join-Path $runRoot "logs"
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

    $eventsPath = Join-Path $logsPath "run-events.jsonl"

    return @{
        RunId = $runId
        RunRoot = $runRoot
        LogsPath = $logsPath
        EventsPath = $eventsPath
    }
}

function Write-LogFileToConsole {
    param(
        [string]$Path,
        [string]$Prefix,
        [string]$Color = "Gray"
    )

    if (-not $Path -or -not (Test-Path $Path)) {
        return
    }

    foreach ($line in (Get-Content -LiteralPath $Path)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        Write-Host "[$Prefix] $line" -ForegroundColor $Color
    }
}

function Format-BenchmarkCommand {
    param(
        [string]$Command,
        [object[]]$Arguments
    )

    $parts = @()
    if (-not [string]::IsNullOrWhiteSpace($Command)) {
        $parts += $Command
    }

    foreach ($argument in @($Arguments)) {
        $text = [string]$argument
        if ($text -match '\s') {
            $parts += '"' + $text + '"'
        } else {
            $parts += $text
        }
    }

    return ($parts -join ' ').Trim()
}

function Invoke-LoggedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$StdoutPath,
        [Parameter(Mandatory = $true)]
        [string]$StderrPath,
        [Parameter(Mandatory = $true)]
        [string]$StdoutPrefix,
        [Parameter(Mandatory = $true)]
        [string]$StderrPrefix,
        [string]$StdoutColor = "Gray",
        [string]$StderrColor = "DarkYellow",
        [string]$InputPath,
        [switch]$NoFinalReplay,
        [int]$GraceSecondsAfterTurnCompleted = 0,
        [int]$MaxIdleSeconds = 0,
        [string[]]$ProcessNamesToStopAfterCapturedTurn = @()
    )

    if (Test-Path $StdoutPath) {
        Remove-Item -LiteralPath $StdoutPath -Force
    }
    if (Test-Path $StderrPath) {
        Remove-Item -LiteralPath $StderrPath -Force
    }

    $argumentText = ($ArgumentList | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' '
    $redirectClause = "1>> `"$StdoutPath`" 2>> `"$StderrPath`""
    $commandText = if ($InputPath) {
        "`$inputText = Get-Content -LiteralPath `"$InputPath`" -Raw; `$inputText | & `"$FilePath`" $argumentText $redirectClause"
    } else {
        "& `"$FilePath`" $argumentText $redirectClause"
    }

    $processStartCutoff = (Get-Date).AddSeconds(-2)
    $job = Start-Job -ScriptBlock {
        param($Directory, $CommandText)
        Set-Location $Directory
        & ([scriptblock]::Create($CommandText))
        return $LASTEXITCODE
    } -ArgumentList $WorkingDirectory, $commandText

    $stdoutOffset = 0
    $stderrOffset = 0
    $turnCompletedAt = $null
    $completedFromCapturedTurn = $false
    $timedOutAfterIdle = $false
    $lastOutputAt = Get-Date

    while ($job.State -eq 'Running') {
        if (Test-Path $StdoutPath) {
            $stdoutLines = @(Get-Content -LiteralPath $StdoutPath)
            while ($stdoutOffset -lt $stdoutLines.Count) {
                $line = $stdoutLines[$stdoutOffset]
                $stdoutOffset++
                $lastOutputAt = Get-Date
                if (($GraceSecondsAfterTurnCompleted -gt 0) -and ($line -like '*"type":"turn.completed"*')) {
                    $turnCompletedAt = Get-Date
                }
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    Write-Host "[$StdoutPrefix] $line" -ForegroundColor $StdoutColor
                }
            }
        }

        if (Test-Path $StderrPath) {
            $stderrLines = @(Get-Content -LiteralPath $StderrPath)
            while ($stderrOffset -lt $stderrLines.Count) {
                $line = $stderrLines[$stderrOffset]
                $stderrOffset++
                $lastOutputAt = Get-Date
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    Write-Host "[$StderrPrefix] $line" -ForegroundColor $StderrColor
                }
            }
        }

        if (($GraceSecondsAfterTurnCompleted -gt 0) -and ($null -ne $turnCompletedAt)) {
            $elapsedAfterTurnCompleted = ((Get-Date) - $turnCompletedAt).TotalSeconds
            if ($elapsedAfterTurnCompleted -ge $GraceSecondsAfterTurnCompleted) {
                Write-Host "[$StdoutPrefix] process still running $([int]$elapsedAfterTurnCompleted)s after turn.completed; continuing with captured output" -ForegroundColor DarkYellow
                $completedFromCapturedTurn = $true
                foreach ($processName in $ProcessNamesToStopAfterCapturedTurn) {
                    Get-Process -Name $processName -ErrorAction SilentlyContinue |
                        Where-Object {
                            try {
                                $_.StartTime -ge $processStartCutoff
                            } catch {
                                $false
                            }
                        } |
                        Stop-Process -Force -ErrorAction SilentlyContinue
                }
                Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
                break
            }
        }

        if (($MaxIdleSeconds -gt 0) -and ($null -eq $turnCompletedAt)) {
            $idleSeconds = ((Get-Date) - $lastOutputAt).TotalSeconds
            if ($idleSeconds -ge $MaxIdleSeconds) {
                Write-Host "[$StdoutPrefix] no output for $([int]$idleSeconds)s; stopping stalled process and continuing" -ForegroundColor DarkYellow
                $timedOutAfterIdle = $true
                foreach ($processName in $ProcessNamesToStopAfterCapturedTurn) {
                    Get-Process -Name $processName -ErrorAction SilentlyContinue |
                        Where-Object {
                            try {
                                $_.StartTime -ge $processStartCutoff
                            } catch {
                                $false
                            }
                        } |
                        Stop-Process -Force -ErrorAction SilentlyContinue
                }
                Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
                break
            }
        }

        Start-Sleep -Milliseconds 200
    }

    $exitCode = if ($completedFromCapturedTurn) {
        0
    } elseif ($timedOutAfterIdle) {
        124
    } else {
        Receive-Job -Job $job
    }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null

    if (-not $NoFinalReplay) {
        Write-LogFileToConsole -Path $StdoutPath -Prefix $StdoutPrefix -Color $StdoutColor
        Write-LogFileToConsole -Path $StderrPath -Prefix $StderrPrefix -Color $StderrColor
    }

    return [int]$exitCode
}

function Write-CodexEventsToConsole {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EventsPath,
        [Parameter(Mandatory = $true)]
        [string]$Condition
    )

    if (-not (Test-Path $EventsPath)) {
        return
    }

    foreach ($line in (Get-Content -LiteralPath $EventsPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        try {
            $event = $line | ConvertFrom-Json -Depth 20
        } catch {
            Write-Host "[$($Condition.ToUpperInvariant())][AI-RAW] $line" -ForegroundColor DarkGray
            continue
        }

        switch ([string]$event.type) {
            "thread.started" {
                Write-Host "[$($Condition.ToUpperInvariant())][AI] thread started id=$($event.thread_id)" -ForegroundColor DarkGray
            }
            "turn.started" {
                Write-Host "[$($Condition.ToUpperInvariant())][AI] turn started" -ForegroundColor DarkGray
            }
            "item.started" {
                if ($null -ne $event.item) {
                    Write-Host "[$($Condition.ToUpperInvariant())][AI][$($event.item.type)] started id=$($event.item.id)" -ForegroundColor DarkGray
                }
            }
            "item.completed" {
                if ($null -eq $event.item) {
                    continue
                }

                switch ([string]$event.item.type) {
                    "agent_message" {
                        Write-Host "[$($Condition.ToUpperInvariant())][AI][message] $($event.item.text)" -ForegroundColor Magenta
                    }
                    "command_execution" {
                        Write-Host "[$($Condition.ToUpperInvariant())][AI][command] $($event.item.command)" -ForegroundColor Blue
                        if ($null -ne $event.item.exit_code) {
                            Write-Host "[$($Condition.ToUpperInvariant())][AI][command-exit] $($event.item.exit_code)" -ForegroundColor Blue
                        }
                        if (-not [string]::IsNullOrWhiteSpace([string]$event.item.aggregated_output)) {
                            foreach ($outputLine in (($event.item.aggregated_output -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
                                Write-Host "[$($Condition.ToUpperInvariant())][AI][command-output] $outputLine" -ForegroundColor DarkBlue
                            }
                        }
                    }
                    "file_change" {
                        foreach ($change in @($event.item.changes)) {
                            Write-Host "[$($Condition.ToUpperInvariant())][AI][file-change] $($change.kind) $($change.path)" -ForegroundColor Yellow
                        }
                    }
                    default {
                        Write-Host "[$($Condition.ToUpperInvariant())][AI][$($event.item.type)] completed id=$($event.item.id)" -ForegroundColor DarkGray
                    }
                }
            }
            "turn.completed" {
                Write-Host "[$($Condition.ToUpperInvariant())][AI] turn completed input=$($event.usage.input_tokens) cached=$($event.usage.cached_input_tokens) output=$($event.usage.output_tokens)" -ForegroundColor Green
            }
            default {
                Write-Host "[$($Condition.ToUpperInvariant())][AI][$($event.type)]" -ForegroundColor DarkGray
            }
        }
    }
}

function New-BenchmarkConditionContext {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [ValidateSet('baseline', 'nanocontext', 'nanocontext-smartsearch')]
        [string]$Condition
    )

    $conditionRoot = Join-Path $RunContext.RunRoot $Condition
    $workspacePath = Join-Path $conditionRoot "workspace"
    $logsPath = Join-Path $conditionRoot "logs"

    New-Item -ItemType Directory -Path $conditionRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $workspacePath -Force | Out-Null
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

    return @{
        Condition = $Condition
        ConditionRoot = $conditionRoot
        WorkspacePath = $workspacePath
        LogsPath = $logsPath
        EventsPath = (Join-Path $logsPath "condition-events.jsonl")
    }
}

function Add-BenchmarkEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EventsPath,
        [Parameter(Mandatory = $true)]
        [string]$Type,
        [hashtable]$Data,
        [string]$MirrorPath
    )

    $payload = @{
        timestamp = ([DateTimeOffset]::UtcNow).ToString("o")
        type = $Type
        data = $(if ($null -ne $Data) { $Data } else { @{} })
    }

    $serialized = $payload | ConvertTo-Json -Depth 20 -Compress
    Add-Content -Path $EventsPath -Value $serialized
    if ($MirrorPath) {
        Add-Content -Path $MirrorPath -Value $serialized
    }

    $hasCondition = $false
    if ($null -ne $Data -and $Data.ContainsKey('condition') -and -not [string]::IsNullOrWhiteSpace([string]$Data.condition)) {
        $hasCondition = $true
    }

    $scope = if ($hasCondition) { ([string]$Data.condition).ToUpperInvariant() } else { "RUN" }
    $details = switch ($Type) {
        "run.start" { "start $($Data.benchmarkId) repo=$($Data.repository) model=$($Data.model)" }
        "run.definition" { "prompt loaded runRoot=$($Data.runRoot)" }
        "clone.cache_hit" { "clone cache hit path=$($Data.clonePath)" }
        "clone.seed_start" { "seeding clone cache from $($Data.sourcePath)" }
        "clone.seed_complete" { "clone cache seeded path=$($Data.clonePath)" }
        "clone.start" { "cwd=$($Data.workingDirectory) cmd=$(Format-BenchmarkCommand -Command 'git' -Arguments $Data.arguments)" }
        "clone.complete" { "clone complete path=$($Data.clonePath)" }
        "clone.failed" { "clone failed exit=$($Data.exitCode)" }
        "indexed.cache_hit" { "indexed cache hit path=$($Data.indexedPath)" }
        "indexed.build_start" { "building indexed cache at $($Data.indexedPath)" }
        "indexed.build_complete" { "indexed cache ready path=$($Data.indexedPath)" }
        "workspace.copy_start" { "cwd=$($Data.workingDirectory) cmd=$(Format-BenchmarkCommand -Command 'Copy-Item' -Arguments @('-LiteralPath', $Data.sourcePath, '-Destination', $Data.workspacePath, '-Recurse', '-Force'))" }
        "workspace.copy_complete" { "workspace copy complete at $($Data.workspacePath)" }
        "nc.init_start" { "cwd=$($Data.workspacePath) cmd=$(Format-BenchmarkCommand -Command $Data.command -Arguments $Data.arguments)" }
        "nc.init_complete" { "nc init complete exit=$($Data.exitCode)" }
        "nc.init_failed" { "nc init failed exit=$($Data.exitCode)" }
        "nc.scan_start" { "cwd=$($Data.workspacePath) cmd=$(Format-BenchmarkCommand -Command $Data.command -Arguments $Data.arguments)" }
        "nc.scan_complete" { "nc scan complete exit=$($Data.exitCode)" }
        "nc.scan_failed" { "nc scan failed exit=$($Data.exitCode)" }
        "condition.start" { "condition start workspace=$($Data.workspacePath)" }
        "agent.exec_start" { "cwd=$($Data.workspacePath) cmd=$(Format-BenchmarkCommand -Command 'codex' -Arguments $Data.arguments) prompt=$($Data.promptPath)" }
        "agent.exec_complete" { "codex exec complete exit=$($Data.exitCode) durationMs=$($Data.durationMs)" }
        "condition.summary_written" { "summary written path=$($Data.summaryPath) tokens=$($Data.totalTokens)" }
        "comparison.summary_written" { "comparison written savings=$($Data.totalTokenSavings)" }
        "run.complete" { "run complete comparison=$($Data.comparisonSummaryPath)" }
        default { ($Data | ConvertTo-Json -Depth 6 -Compress) }
    }

    $color = switch -Wildcard ($Type) {
        "*.failed" { "Red" }
        "*.start" { "Cyan" }
        "*.complete" { "Green" }
        "*cache_hit" { "DarkCyan" }
        "*summary_written" { "Yellow" }
        default { "Gray" }
    }

    Write-Host "[$scope][$Type] $details" -ForegroundColor $color
}

function Ensure-BenchmarkClone {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$RepositoryDefinition,
        [string]$EventsPath
    )

    $clonePath = Join-Path (Get-BenchmarkCloneRoot) $RepositoryDefinition.Name
    if (Test-Path $clonePath) {
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.cache_hit" -Data @{
                repository = $RepositoryDefinition.Name
                clonePath = $clonePath
            }
        }
        return $clonePath
    }

    $benchmarkRoot = Get-BenchmarkRoot
    $fallbackSources = @(
        (Join-Path $benchmarkRoot "repos\_nc_indexed\$($RepositoryDefinition.Name)"),
        (Join-Path $benchmarkRoot "repos\clean\$($RepositoryDefinition.Name)\task1-trace")
    )

    foreach ($sourcePath in $fallbackSources) {
        if (-not (Test-Path $sourcePath)) {
            continue
        }

        Write-Host "Seeding benchmark cache for $($RepositoryDefinition.Name) from $sourcePath..." -ForegroundColor Yellow
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.seed_start" -Data @{
                repository = $RepositoryDefinition.Name
                sourcePath = $sourcePath
                clonePath = $clonePath
            }
        }
        New-Item -ItemType Directory -Path $clonePath -Force | Out-Null
        Get-ChildItem -LiteralPath $sourcePath -Force | Copy-Item -Destination $clonePath -Recurse -Force
        Remove-BenchmarkScaffolding -WorkspacePath $clonePath
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.seed_complete" -Data @{
                repository = $RepositoryDefinition.Name
                sourcePath = $sourcePath
                clonePath = $clonePath
            }
        }
        return $clonePath
    }

    Write-Host "Cloning $($RepositoryDefinition.Name) into benchmark cache..." -ForegroundColor Yellow
    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.start" -Data @{
            repository = $RepositoryDefinition.Name
            url = $RepositoryDefinition.Url
            clonePath = $clonePath
            workingDirectory = (Get-BenchmarkCloneRoot)
            arguments = @("clone", "--depth", "1", $RepositoryDefinition.Url, $clonePath)
        }
    }
    & git clone --depth 1 $RepositoryDefinition.Url $clonePath
    if ($LASTEXITCODE -ne 0) {
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.failed" -Data @{
                repository = $RepositoryDefinition.Name
                clonePath = $clonePath
                exitCode = $LASTEXITCODE
            }
        }
        throw "git clone failed for $($RepositoryDefinition.Name) with exit code $LASTEXITCODE"
    }

    $gitDir = Join-Path $clonePath ".git"
    if (Test-Path $gitDir) {
        Remove-Item $gitDir -Recurse -Force
    }

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "clone.complete" -Data @{
            repository = $RepositoryDefinition.Name
            clonePath = $clonePath
        }
    }

    return $clonePath
}

function Ensure-BenchmarkIndexedCache {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$RepositoryDefinition,
        [string]$EventsPath,
        [bool]$SmartSearchEnabled = $false
    )

    $isSmartSearchEnabled = $SmartSearchEnabled
    $cacheSuffix = if ($isSmartSearchEnabled) { "-smartsearch" } else { "" }
    $indexedPath = Join-Path (Get-BenchmarkIndexedRoot) "$($RepositoryDefinition.Name)$cacheSuffix"
    if ((Test-Path (Join-Path $indexedPath ".nanocontext")) -and
        (Test-Path (Join-Path $indexedPath "nanocontextconfig.json")) -and
        (Test-BenchmarkAgentSetup -WorkspacePath $indexedPath)) {
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "indexed.cache_hit" -Data @{
                repository = $RepositoryDefinition.Name
                indexedPath = $indexedPath
                smartSearchEnabled = $isSmartSearchEnabled
            }
        }
        return $indexedPath
    }

    if (Test-Path $indexedPath) {
        Remove-Item $indexedPath -Recurse -Force
    }

    if ($isSmartSearchEnabled) {
        $baseIndexedPath = Ensure-BenchmarkIndexedCache -RepositoryDefinition $RepositoryDefinition -EventsPath $EventsPath
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "indexed.smartsearch_derive_start" -Data @{
                repository = $RepositoryDefinition.Name
                sourcePath = $baseIndexedPath
                indexedPath = $indexedPath
                smartSearchEnabled = $isSmartSearchEnabled
            }
        }

        New-Item -ItemType Directory -Path $indexedPath -Force | Out-Null
        Get-ChildItem -LiteralPath $baseIndexedPath -Force | Copy-Item -Destination $indexedPath -Recurse -Force
        Enable-BenchmarkSmartSearchConfig -WorkspacePath $indexedPath

        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "indexed.smartsearch_derive_complete" -Data @{
                repository = $RepositoryDefinition.Name
                sourcePath = $baseIndexedPath
                indexedPath = $indexedPath
                smartSearchEnabled = $isSmartSearchEnabled
            }
        }
        return $indexedPath
    }

    $clonePath = Ensure-BenchmarkClone -RepositoryDefinition $RepositoryDefinition -EventsPath $EventsPath
    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "indexed.build_start" -Data @{
            repository = $RepositoryDefinition.Name
            clonePath = $clonePath
            indexedPath = $indexedPath
            smartSearchEnabled = $isSmartSearchEnabled
        }
    }
    New-Item -ItemType Directory -Path $indexedPath -Force | Out-Null
    Get-ChildItem -LiteralPath $clonePath -Force | Copy-Item -Destination $indexedPath -Recurse -Force

    Invoke-NanoContextInit -RepositoryDefinition $RepositoryDefinition -WorkspacePath $indexedPath -EventsPath $EventsPath -SmartSearchEnabled $isSmartSearchEnabled
    Invoke-NanoContextScan -WorkspacePath $indexedPath -LogsPath (Join-Path $indexedPath ".nanocontext\logs") -EventsPath $EventsPath

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "indexed.build_complete" -Data @{
            repository = $RepositoryDefinition.Name
            indexedPath = $indexedPath
            smartSearchEnabled = $isSmartSearchEnabled
        }
    }
    return $indexedPath
}

function Enable-BenchmarkSmartSearchConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath
    )

    $configPath = Join-Path $WorkspacePath "nanocontextconfig.json"
    if (-not (Test-Path $configPath)) {
        throw "NanoContext project config missing at $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($null -eq $config.search) {
        $config | Add-Member -MemberType NoteProperty -Name search -Value ([pscustomobject]@{})
    }
    if ($config.search.PSObject.Properties.Name -contains 'smartSearchEnabled') {
        $config.search.smartSearchEnabled = $true
    } else {
        $config.search | Add-Member -MemberType NoteProperty -Name smartSearchEnabled -Value $true
    }

    Set-Content -Path $configPath -Value ($config | ConvertTo-Json -Depth 20) -Encoding UTF8
}

function Remove-BenchmarkScaffolding {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath
    )

    $pathsToRemove = @(
        (Join-Path $WorkspacePath ".nanocontext"),
        (Join-Path $WorkspacePath ".codex"),
        (Join-Path $WorkspacePath ".mcp.json"),
        (Join-Path $WorkspacePath "nanocontextconfig.json"),
        (Join-Path $WorkspacePath ".nanocontextignore"),
        (Join-Path $WorkspacePath "TASK.md"),
        (Join-Path $WorkspacePath "AGENTS.md")
    )

    foreach ($path in $pathsToRemove) {
        if (Test-Path $path) {
            Remove-Item $path -Recurse -Force
        }
    }
}

function Copy-BenchmarkWorkspace {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ClonePath,
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath,
        [string]$EventsPath,
        [string]$Condition
    )

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "workspace.copy_start" -Data @{
            condition = $Condition
            sourcePath = $ClonePath
            workspacePath = $WorkspacePath
            workingDirectory = Split-Path -Parent $WorkspacePath
        }
    }
    Get-ChildItem -LiteralPath $ClonePath -Force | Copy-Item -Destination $WorkspacePath -Recurse -Force
    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "workspace.copy_complete" -Data @{
            condition = $Condition
            sourcePath = $ClonePath
            workspacePath = $WorkspacePath
        }
    }
}

function Invoke-NanoContextInit {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$RepositoryDefinition,
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath,
        [string]$EventsPath,
        [bool]$SmartSearchEnabled = $false
    )
    $ncCli = Get-NanoContextCli
    Import-BenchmarkEnv
    $llmProvider = Get-BenchmarkEnvValue -Name 'NC_INIT_LLM_PROVIDER' -DefaultValue 'openai'
    $llmModel = Get-BenchmarkEnvValue -Name 'NC_INIT_LLM_MODEL' -DefaultValue 'gpt-5-mini-2025-08-07'
    $llmApiKeyRequired = $llmProvider -in @('openai', 'anthropic')
    $llmApiKey = Get-BenchmarkEnvValue -Name 'NC_INIT_LLM_API_KEY' -DefaultValue '' -Required:$llmApiKeyRequired
    $embeddingProvider = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_PROVIDER' -DefaultValue 'openai'
    $embeddingModel = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_MODEL' -DefaultValue 'text-embedding-3-small'
    $embeddingApiKeyRequired = $embeddingProvider -eq 'openai' -and [string]::IsNullOrWhiteSpace($llmApiKey)
    $embeddingApiKey = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_API_KEY' -DefaultValue $llmApiKey -Required:$embeddingApiKeyRequired
    $embeddingEndpoint = Get-BenchmarkEnvValue -Name 'NC_INIT_EMBEDDING_ENDPOINT' -DefaultValue $null
    $initSettings = Resolve-BenchmarkInitSettings
    $mode = $initSettings.Mode
    $agents = (@($initSettings.Agents) -join ',')
    $smartSearchEnabled = if ($SmartSearchEnabled) { 'true' } else { (Get-BenchmarkEnvValue -Name 'NC_INIT_SMART_SEARCH' -DefaultValue 'false').ToLowerInvariant() }

    $initLogsPath = Join-Path $WorkspacePath ".nanocontext\logs"
    New-Item -ItemType Directory -Path $initLogsPath -Force | Out-Null
    $stdoutPath = Join-Path $initLogsPath "nc-init.stdout.log"
    $stderrPath = Join-Path $initLogsPath "nc-init.stderr.log"
    $arguments = @(
        "init",
        "--llm-provider", $llmProvider,
        "--llm-model", $llmModel,
        "--embedding-provider", $embeddingProvider,
        "--embedding-model", $embeddingModel,
        "--include", ($RepositoryDefinition.Include -join ","),
        "--mode", $mode,
        "--agents", $agents,
        "--yes"
    )
    if (-not [string]::IsNullOrWhiteSpace($llmApiKey)) {
        $arguments += @("--llm-api-key", $llmApiKey)
    }
    if (-not [string]::IsNullOrWhiteSpace($embeddingApiKey)) {
        $arguments += @("--embedding-api-key", $embeddingApiKey)
    }
    if (-not [string]::IsNullOrWhiteSpace($embeddingEndpoint)) {
        $arguments += @("--embedding-endpoint", $embeddingEndpoint)
    }
    if ($smartSearchEnabled -eq 'true') {
        $arguments += "--smart-search"
    }

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.init_start" -Data @{
            repository = $RepositoryDefinition.Name
            workspacePath = $WorkspacePath
            command = $ncCli.Command
            arguments = @($ncCli.Args + $arguments)
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
        }
    }

    Push-Location $WorkspacePath
    try {
        $exitCode = Invoke-LoggedProcess `
            -FilePath $ncCli.Command `
            -ArgumentList @($ncCli.Args + $arguments) `
            -WorkingDirectory $WorkspacePath `
            -StdoutPath $stdoutPath `
            -StderrPath $stderrPath `
            -StdoutPrefix "NC-INIT-STDOUT" `
            -StderrPrefix "NC-INIT-STDERR" `
            -StdoutColor "DarkGray" `
            -StderrColor "DarkYellow"
    } finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.init_failed" -Data @{
                repository = $RepositoryDefinition.Name
                workspacePath = $WorkspacePath
                exitCode = $exitCode
                stdoutPath = $stdoutPath
                stderrPath = $stderrPath
            }
        }
        throw "nc init failed with exit code $exitCode. See $stderrPath"
    }

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.init_complete" -Data @{
            repository = $RepositoryDefinition.Name
            workspacePath = $WorkspacePath
            exitCode = $exitCode
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
        }
    }
}

function Invoke-NanoContextScan {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath,
        [Parameter(Mandatory = $true)]
        [string]$LogsPath,
        [string]$EventsPath
    )

    $ncCli = Get-NanoContextCli
    New-Item -ItemType Directory -Path $LogsPath -Force | Out-Null
    $stdoutPath = Join-Path $LogsPath "nc-scan.stdout.log"
    $stderrPath = Join-Path $LogsPath "nc-scan.stderr.log"

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.scan_start" -Data @{
            workspacePath = $WorkspacePath
            command = $ncCli.Command
            arguments = @($ncCli.Args + @("scan"))
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
        }
    }

    Push-Location $WorkspacePath
    try {
        $exitCode = Invoke-LoggedProcess `
            -FilePath $ncCli.Command `
            -ArgumentList @($ncCli.Args + @("scan")) `
            -WorkingDirectory $WorkspacePath `
            -StdoutPath $stdoutPath `
            -StderrPath $stderrPath `
            -StdoutPrefix "NC-SCAN-STDOUT" `
            -StderrPrefix "NC-SCAN-STDERR" `
            -StdoutColor "DarkGray" `
            -StderrColor "DarkYellow"
    } finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        if ($EventsPath) {
            Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.scan_failed" -Data @{
                workspacePath = $WorkspacePath
                exitCode = $exitCode
                stdoutPath = $stdoutPath
                stderrPath = $stderrPath
            }
        }
        throw "nc scan failed with exit code $exitCode. See $stderrPath"
    }

    if ($EventsPath) {
        Add-BenchmarkEvent -EventsPath $EventsPath -Type "nc.scan_complete" -Data @{
            workspacePath = $WorkspacePath
            exitCode = $exitCode
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
        }
    }
}

function Invoke-CodexBenchmark {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TaskDefinition,
        [Parameter(Mandatory = $true)]
        [hashtable]$ConditionContext,
        [string]$Model,
        [string]$RunEventsPath
    )

    $promptPath = Join-Path $ConditionContext.ConditionRoot "prompt.txt"
    $agentEventsPath = Join-Path $ConditionContext.LogsPath "codex-events.jsonl"
    $stderrPath = Join-Path $ConditionContext.LogsPath "codex-stderr.log"
    $stdoutPath = Join-Path $ConditionContext.LogsPath "codex-stdout.log"
    $commandPath = Join-Path $ConditionContext.ConditionRoot "command.json"

    $executionPrompt = Get-BenchmarkExecutionPrompt -TaskPrompt $TaskDefinition.Prompt
    Set-Content -Path $promptPath -Value $executionPrompt -Encoding UTF8

    $execSettings = Resolve-BenchmarkCodexExecSettings
    $arguments = @()
    if ($execSettings.UseDangerouslyBypass) {
        $arguments += "--dangerously-bypass-approvals-and-sandbox"
    } else {
        $arguments += "--full-auto"
    }
    $arguments += @(
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check"
    )
    $resolvedModel = Resolve-BenchmarkCodexRunModel -Model $Model
    if (-not [string]::IsNullOrWhiteSpace($resolvedModel)) {
        $arguments += @("--model", $resolvedModel)
    }
    $arguments += "-"

    $commandRecord = @{
        command = "codex"
        arguments = $arguments
        workingDirectory = $ConditionContext.WorkspacePath
        promptPath = $promptPath
    }
    Set-Content -Path $commandPath -Value ($commandRecord | ConvertTo-Json -Depth 10) -Encoding UTF8

    $startedAt = Get-Date

    if ($RunEventsPath) {
        Add-BenchmarkEvent -EventsPath $RunEventsPath -MirrorPath $ConditionContext.EventsPath -Type "agent.exec_start" -Data @{
            condition = $ConditionContext.Condition
            workspacePath = $ConditionContext.WorkspacePath
            promptPath = $promptPath
            commandPath = $commandPath
            arguments = $arguments
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
            eventsPath = $agentEventsPath
            model = $(if ($resolvedModel) { $resolvedModel } else { "default" })
        }
    }

    Push-Location $ConditionContext.WorkspacePath
    try {
        $exitCode = Invoke-LoggedProcess `
            -FilePath "codex" `
            -ArgumentList $arguments `
            -WorkingDirectory $ConditionContext.WorkspacePath `
            -StdoutPath $agentEventsPath `
            -StderrPath $stderrPath `
            -StdoutPrefix "$($ConditionContext.Condition.ToUpperInvariant())-AI-EVENT" `
            -StderrPrefix "$($ConditionContext.Condition.ToUpperInvariant())-AI-STDERR" `
            -StdoutColor "DarkGray" `
            -StderrColor "DarkYellow" `
            -InputPath $promptPath `
            -NoFinalReplay `
            -GraceSecondsAfterTurnCompleted 30 `
            -MaxIdleSeconds 300 `
            -ProcessNamesToStopAfterCapturedTurn @("codex")
        Set-Content -Path $stdoutPath -Value (Get-Content -LiteralPath $promptPath -Raw) -Encoding UTF8
    } finally {
        Pop-Location
    }

    Write-Host "[$($ConditionContext.Condition.ToUpperInvariant())-PROMPT] $promptPath" -ForegroundColor DarkGray

    $completedAt = Get-Date

    if ($RunEventsPath) {
        Add-BenchmarkEvent -EventsPath $RunEventsPath -MirrorPath $ConditionContext.EventsPath -Type "agent.exec_complete" -Data @{
            condition = $ConditionContext.Condition
            workspacePath = $ConditionContext.WorkspacePath
            exitCode = $exitCode
            stdoutPath = $stdoutPath
            stderrPath = $stderrPath
            eventsPath = $agentEventsPath
            durationMs = [Math]::Round((([DateTimeOffset]$completedAt) - ([DateTimeOffset]$startedAt)).TotalMilliseconds)
        }
    }

    return @{
        PromptPath = $promptPath
        EventsPath = $agentEventsPath
        StderrPath = $stderrPath
        StdoutPath = $stdoutPath
        CommandPath = $commandPath
        ExitCode = $exitCode
        StartedAt = $startedAt
        CompletedAt = $completedAt
    }
}

function Get-CodexBenchmarkSummary {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TaskDefinition,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [hashtable]$ConditionContext,
        [Parameter(Mandatory = $true)]
        [hashtable]$ExecutionResult,
        [string]$Model
    )

    $resolvedModel = Resolve-BenchmarkCodexRunModel -Model $Model
    $eventCounts = @{}
    $lastAgentMessage = $null
    $lastTurnUsage = $null
    $turnCompletedCount = 0
    $nonJsonLines = @()
    $consoleMessages = @()
    $commands = @()
    $fileChanges = @()
    $failedCommandCount = 0
    $emptyResultCount = 0
    $normalizedCommands = @()

    foreach ($line in (Get-Content -LiteralPath $ExecutionResult.EventsPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        try {
            $event = $line | ConvertFrom-Json -Depth 20
        } catch {
            $nonJsonLines += $line
            continue
        }

        if ($event.type -eq "item.completed" -and $null -ne $event.item) {
            $itemType = [string]$event.item.type
            if (-not $eventCounts.ContainsKey($itemType)) {
                $eventCounts[$itemType] = 0
            }
            $eventCounts[$itemType]++

            if ($itemType -eq "agent_message") {
                $lastAgentMessage = $event.item.text
                $consoleMessages += @{
                    id = $event.item.id
                    text = $event.item.text
                }
            }

            if ($itemType -eq "command_execution") {
                $commands += @{
                    id = $event.item.id
                    command = $event.item.command
                    output = $event.item.aggregated_output
                    exitCode = $event.item.exit_code
                }
                if ($null -ne $event.item.exit_code -and [int]$event.item.exit_code -ne 0) {
                    $failedCommandCount++
                }
                $normalizedCommands += (Normalize-BenchmarkCommandText -CommandText ([string]$event.item.command))
                $aggregatedOutput = [string]$event.item.aggregated_output
                if ($aggregatedOutput -match "No results found|No memories found|Memory not found|No refs found|No callers found|No trace found") {
                    $emptyResultCount++
                }
            }

            if ($itemType -eq "file_change") {
                $fileChanges += @{
                    id = $event.item.id
                    changes = $event.item.changes
                }
            }
        }

        if ($event.type -eq "turn.completed") {
            $turnCompletedCount++
            $lastTurnUsage = $event.usage
        }
    }

    $startedAt = [DateTimeOffset]$ExecutionResult.StartedAt
    $completedAt = [DateTimeOffset]$ExecutionResult.CompletedAt

    return @{
        benchmarkId = $TaskDefinition.Id
        repository = $TaskDefinition.Repository
        taskKey = $TaskDefinition.TaskKey
        condition = $ConditionContext.Condition
        agent = "codex"
        model = $(if ($resolvedModel) { $resolvedModel } else { "default" })
        runId = $RunContext.RunId
        runRoot = $RunContext.RunRoot
        conditionRoot = $ConditionContext.ConditionRoot
        workspacePath = $ConditionContext.WorkspacePath
        promptPath = $ExecutionResult.PromptPath
        eventsPath = $ExecutionResult.EventsPath
        stdoutPath = $ExecutionResult.StdoutPath
        stderrPath = $ExecutionResult.StderrPath
        commandPath = $ExecutionResult.CommandPath
        exitCode = $ExecutionResult.ExitCode
        startedAt = $startedAt.ToString("o")
        completedAt = $completedAt.ToString("o")
        durationMs = [Math]::Round(($completedAt - $startedAt).TotalMilliseconds)
        turnCompletedCount = $turnCompletedCount
        usage = $lastTurnUsage
        eventCounts = $eventCounts
        finalAnswer = $lastAgentMessage
        consoleMessages = $consoleMessages
        commands = $commands
        fileChanges = $fileChanges
        exploration = @{
            commandCount = @($commands).Count
            failedCommandCount = $failedCommandCount
            emptyResultCount = $emptyResultCount
            repeatedQueryCount = (Get-RepeatedBenchmarkCommandCount -Commands $normalizedCommands)
            tokenCostPerCommand = $(if (@($commands).Count -gt 0 -and $lastTurnUsage) { [Math]::Round(((Get-TotalTokens -Usage $lastTurnUsage) / @($commands).Count), 2) } else { $null })
        }
        nonJsonEventLines = $nonJsonLines
    }
}

function Write-BenchmarkSummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [Parameter(Mandatory = $true)]
        [hashtable]$Summary
    )

    Set-Content -Path $TargetPath -Value ($Summary | ConvertTo-Json -Depth 20) -Encoding UTF8
    return $TargetPath
}

function Get-BenchmarkComparisonSummary {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TaskDefinition,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [hashtable]$BaselineSummary,
        [Parameter(Mandatory = $true)]
        [hashtable]$NanoContextSummary,
        [Parameter(Mandatory = $true)]
        [hashtable]$NanoContextSmartSearchSummary,
        [string]$Model,
        [string]$CloneCachePath,
        [string]$IndexedCachePath,
        [string]$IndexedSmartSearchCachePath
    )

    $resolvedModel = Resolve-BenchmarkCodexRunModel -Model $Model
    $baselineTotalTokens = Get-TotalTokens -Usage $BaselineSummary.usage
    $nanocontextTotalTokens = Get-TotalTokens -Usage $NanoContextSummary.usage
    $smartsearchTotalTokens = Get-TotalTokens -Usage $NanoContextSmartSearchSummary.usage
    $nanocontextVsBaselineTotalTokenDelta = Get-NullableDelta -Left $nanocontextTotalTokens -Right $baselineTotalTokens
    $smartsearchVsBaselineTotalTokenDelta = Get-NullableDelta -Left $smartsearchTotalTokens -Right $baselineTotalTokens
    $smartsearchVsNanocontextTotalTokenDelta = Get-NullableDelta -Left $smartsearchTotalTokens -Right $nanocontextTotalTokens

    return @{
        benchmarkId = $TaskDefinition.Id
        repository = $TaskDefinition.Repository
        taskKey = $TaskDefinition.TaskKey
        runId = $RunContext.RunId
        runRoot = $RunContext.RunRoot
        agent = "codex"
        model = $(if ($resolvedModel) { $resolvedModel } else { "default" })
        cloneCachePath = $CloneCachePath
        indexedCachePath = $IndexedCachePath
        indexedSmartSearchCachePath = $IndexedSmartSearchCachePath
        prompt = $TaskDefinition.Prompt
        baseline = @{
            summaryPath = (Join-Path (Join-Path $RunContext.RunRoot "baseline") "summary.json")
            exitCode = $BaselineSummary.exitCode
            durationMs = $BaselineSummary.durationMs
            totalTokens = $baselineTotalTokens
            usage = $BaselineSummary.usage
            eventCounts = $BaselineSummary.eventCounts
            finalAnswer = $BaselineSummary.finalAnswer
        }
        nanocontext = @{
            summaryPath = (Join-Path (Join-Path $RunContext.RunRoot "nanocontext") "summary.json")
            exitCode = $NanoContextSummary.exitCode
            durationMs = $NanoContextSummary.durationMs
            totalTokens = $nanocontextTotalTokens
            usage = $NanoContextSummary.usage
            eventCounts = $NanoContextSummary.eventCounts
            finalAnswer = $NanoContextSummary.finalAnswer
        }
        nanocontextSmartSearch = @{
            summaryPath = (Join-Path (Join-Path $RunContext.RunRoot "nanocontext-smartsearch") "summary.json")
            exitCode = $NanoContextSmartSearchSummary.exitCode
            durationMs = $NanoContextSmartSearchSummary.durationMs
            totalTokens = $smartsearchTotalTokens
            usage = $NanoContextSmartSearchSummary.usage
            eventCounts = $NanoContextSmartSearchSummary.eventCounts
            finalAnswer = $NanoContextSmartSearchSummary.finalAnswer
        }
        comparison = @{
            nanocontextVsBaselineTotalTokenDelta = $nanocontextVsBaselineTotalTokenDelta
            nanocontextVsBaselineTotalTokenSavings = Get-NullableDelta -Left $baselineTotalTokens -Right $nanocontextTotalTokens
            nanocontextVsBaselineDurationDeltaMs = $NanoContextSummary.durationMs - $BaselineSummary.durationMs
            smartsearchVsBaselineTotalTokenDelta = $smartsearchVsBaselineTotalTokenDelta
            smartsearchVsBaselineTotalTokenSavings = Get-NullableDelta -Left $baselineTotalTokens -Right $smartsearchTotalTokens
            smartsearchVsBaselineDurationDeltaMs = $NanoContextSmartSearchSummary.durationMs - $BaselineSummary.durationMs
            smartsearchVsNanocontextTotalTokenDelta = $smartsearchVsNanocontextTotalTokenDelta
            smartsearchVsNanocontextTotalTokenSavings = Get-NullableDelta -Left $nanocontextTotalTokens -Right $smartsearchTotalTokens
            smartsearchVsNanocontextDurationDeltaMs = $NanoContextSmartSearchSummary.durationMs - $NanoContextSummary.durationMs
            baselineCommandCount = @($BaselineSummary.commands).Count
            nanocontextCommandCount = @($NanoContextSummary.commands).Count
            nanocontextSmartSearchCommandCount = @($NanoContextSmartSearchSummary.commands).Count
            baselineFileChangeCount = @($BaselineSummary.fileChanges).Count
            nanocontextFileChangeCount = @($NanoContextSummary.fileChanges).Count
            nanocontextSmartSearchFileChangeCount = @($NanoContextSmartSearchSummary.fileChanges).Count
            baselineExploration = $BaselineSummary.exploration
            nanocontextExploration = $NanoContextSummary.exploration
            nanocontextSmartSearchExploration = $NanoContextSmartSearchSummary.exploration
            budgets = @{
                baselineMaxCommandCount = 25
                nanocontextMaxCommandCount = 40
                smartsearchMaxCommandCount = 35
                nanocontextWithinBudget = (($NanoContextSummary.exploration.commandCount ?? 0) -le 40)
                smartsearchWithinBudget = (($NanoContextSmartSearchSummary.exploration.commandCount ?? 0) -le 35)
            }
        }
    }
}

function Get-NullableDelta {
    param(
        $Left,
        $Right
    )

    if (($null -eq $Left) -or ($null -eq $Right)) {
        return $null
    }

    return $Left - $Right
}

function Normalize-BenchmarkCommandText {
    param(
        [string]$CommandText
    )

    if ([string]::IsNullOrWhiteSpace($CommandText)) {
        return ""
    }

    return (($CommandText -replace '\[[^\]]+\]', '') -replace '\s+', ' ').Trim().ToLowerInvariant()
}

function Get-RepeatedBenchmarkCommandCount {
    param(
        [string[]]$Commands
    )

    if ($null -eq $Commands) {
        return 0
    }

    $counts = @{}
    foreach ($command in $Commands) {
        if ([string]::IsNullOrWhiteSpace($command)) {
            continue
        }
        if (-not $counts.ContainsKey($command)) {
            $counts[$command] = 0
        }
        $counts[$command]++
    }

    $repeated = 0
    foreach ($entry in $counts.GetEnumerator()) {
        if ([int]$entry.Value -gt 1) {
            $repeated += ([int]$entry.Value - 1)
        }
    }

    return $repeated
}

function Get-TotalTokens {
    param(
        $Usage
    )

    if (($null -eq $Usage) -or ($null -eq $Usage.input_tokens) -or ($null -eq $Usage.output_tokens)) {
        return $null
    }

    return [int]$Usage.input_tokens + [int]$Usage.output_tokens
}

function Invoke-BenchmarkRun {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TaskDefinition,
        [Parameter(Mandatory = $true)]
        [hashtable]$RepositoryDefinition,
        [string]$Model
    )

    $resolvedModel = Resolve-BenchmarkCodexRunModel -Model $Model
    $taskDefinition = $TaskDefinition
    $repositoryDefinition = $RepositoryDefinition
    $runContext = New-BenchmarkRunContext -TaskDefinition $taskDefinition
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -Type "run.start" -Data @{
        benchmarkId = $taskDefinition.Id
        repository = $repositoryDefinition.Name
        taskKey = $taskDefinition.TaskKey
        model = $(if ($resolvedModel) { $resolvedModel } else { "default" })
    }

    $clonePath = Join-Path (Get-BenchmarkCloneRoot) $repositoryDefinition.Name
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -Type "run.definition" -Data @{
        benchmarkId = $taskDefinition.Id
        repository = $repositoryDefinition.Name
        prompt = $taskDefinition.Prompt
        runRoot = $runContext.RunRoot
    }
    $indexedPath = Ensure-BenchmarkIndexedCache -RepositoryDefinition $repositoryDefinition -EventsPath $runContext.EventsPath
    $indexedSmartSearchPath = Ensure-BenchmarkIndexedCache -RepositoryDefinition $repositoryDefinition -EventsPath $runContext.EventsPath -SmartSearchEnabled $true
    $baselineContext = New-BenchmarkConditionContext -RunContext $runContext -Condition baseline
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $baselineContext.EventsPath -Type "condition.start" -Data @{
        condition = "baseline"
        workspacePath = $baselineContext.WorkspacePath
    }
    Copy-BenchmarkWorkspace -ClonePath $clonePath -WorkspacePath $baselineContext.WorkspacePath -EventsPath $runContext.EventsPath -Condition "baseline"
    $baselineExecution = Invoke-CodexBenchmark -TaskDefinition $taskDefinition -ConditionContext $baselineContext -Model $Model -RunEventsPath $runContext.EventsPath
    $baselineSummary = Get-CodexBenchmarkSummary -TaskDefinition $taskDefinition -RunContext $runContext -ConditionContext $baselineContext -ExecutionResult $baselineExecution -Model $Model
    $baselineSummary.cloneCachePath = $clonePath
    $baselineSummary.indexedCachePath = $indexedPath
    $baselineSummary.runEventsPath = $runContext.EventsPath
    $baselineSummary.conditionEventsPath = $baselineContext.EventsPath
    $baselineSummaryPath = Write-BenchmarkSummary -TargetPath (Join-Path $baselineContext.ConditionRoot "summary.json") -Summary $baselineSummary
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $baselineContext.EventsPath -Type "condition.summary_written" -Data @{
        condition = "baseline"
        summaryPath = $baselineSummaryPath
        exitCode = $baselineSummary.exitCode
        totalTokens = (Get-TotalTokens -Usage $baselineSummary.usage)
    }

    $nanocontextContext = New-BenchmarkConditionContext -RunContext $runContext -Condition nanocontext
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $nanocontextContext.EventsPath -Type "condition.start" -Data @{
        condition = "nanocontext"
        workspacePath = $nanocontextContext.WorkspacePath
    }
    Copy-BenchmarkWorkspace -ClonePath $indexedPath -WorkspacePath $nanocontextContext.WorkspacePath -EventsPath $runContext.EventsPath -Condition "nanocontext"
    $nanocontextExecution = Invoke-CodexBenchmark -TaskDefinition $taskDefinition -ConditionContext $nanocontextContext -Model $Model -RunEventsPath $runContext.EventsPath
    $nanocontextSummary = Get-CodexBenchmarkSummary -TaskDefinition $taskDefinition -RunContext $runContext -ConditionContext $nanocontextContext -ExecutionResult $nanocontextExecution -Model $Model
    $nanocontextSummary.cloneCachePath = $clonePath
    $nanocontextSummary.indexedCachePath = $indexedPath
    $nanocontextSummary.indexedSmartSearchCachePath = $indexedSmartSearchPath
    $nanocontextSummary.runEventsPath = $runContext.EventsPath
    $nanocontextSummary.conditionEventsPath = $nanocontextContext.EventsPath
    $nanocontextSummaryPath = Write-BenchmarkSummary -TargetPath (Join-Path $nanocontextContext.ConditionRoot "summary.json") -Summary $nanocontextSummary
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $nanocontextContext.EventsPath -Type "condition.summary_written" -Data @{
        condition = "nanocontext"
        summaryPath = $nanocontextSummaryPath
        exitCode = $nanocontextSummary.exitCode
        totalTokens = (Get-TotalTokens -Usage $nanocontextSummary.usage)
    }

    $nanocontextSmartSearchContext = New-BenchmarkConditionContext -RunContext $runContext -Condition "nanocontext-smartsearch"
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $nanocontextSmartSearchContext.EventsPath -Type "condition.start" -Data @{
        condition = "nanocontext-smartsearch"
        workspacePath = $nanocontextSmartSearchContext.WorkspacePath
    }
    Copy-BenchmarkWorkspace -ClonePath $indexedSmartSearchPath -WorkspacePath $nanocontextSmartSearchContext.WorkspacePath -EventsPath $runContext.EventsPath -Condition "nanocontext-smartsearch"
    $nanocontextSmartSearchExecution = Invoke-CodexBenchmark -TaskDefinition $taskDefinition -ConditionContext $nanocontextSmartSearchContext -Model $Model -RunEventsPath $runContext.EventsPath
    $nanocontextSmartSearchSummary = Get-CodexBenchmarkSummary -TaskDefinition $taskDefinition -RunContext $runContext -ConditionContext $nanocontextSmartSearchContext -ExecutionResult $nanocontextSmartSearchExecution -Model $Model
    $nanocontextSmartSearchSummary.cloneCachePath = $clonePath
    $nanocontextSmartSearchSummary.indexedCachePath = $indexedPath
    $nanocontextSmartSearchSummary.indexedSmartSearchCachePath = $indexedSmartSearchPath
    $nanocontextSmartSearchSummary.runEventsPath = $runContext.EventsPath
    $nanocontextSmartSearchSummary.conditionEventsPath = $nanocontextSmartSearchContext.EventsPath
    $nanocontextSmartSearchSummaryPath = Write-BenchmarkSummary -TargetPath (Join-Path $nanocontextSmartSearchContext.ConditionRoot "summary.json") -Summary $nanocontextSmartSearchSummary
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -MirrorPath $nanocontextSmartSearchContext.EventsPath -Type "condition.summary_written" -Data @{
        condition = "nanocontext-smartsearch"
        summaryPath = $nanocontextSmartSearchSummaryPath
        exitCode = $nanocontextSmartSearchSummary.exitCode
        totalTokens = (Get-TotalTokens -Usage $nanocontextSmartSearchSummary.usage)
    }

    $comparisonSummary = Get-BenchmarkComparisonSummary `
        -TaskDefinition $taskDefinition `
        -RunContext $runContext `
        -BaselineSummary $baselineSummary `
        -NanoContextSummary $nanocontextSummary `
        -NanoContextSmartSearchSummary $nanocontextSmartSearchSummary `
        -Model $Model `
        -CloneCachePath $clonePath `
        -IndexedCachePath $indexedPath `
        -IndexedSmartSearchCachePath $indexedSmartSearchPath
    $comparisonSummary.runEventsPath = $runContext.EventsPath
    $comparisonSummaryPath = Write-BenchmarkSummary -TargetPath (Join-Path $runContext.RunRoot "comparison.json") -Summary $comparisonSummary
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -Type "comparison.summary_written" -Data @{
        summaryPath = $comparisonSummaryPath
        baselineSummaryPath = $baselineSummaryPath
        nanocontextSummaryPath = $nanocontextSummaryPath
        nanocontextSmartSearchSummaryPath = $nanocontextSmartSearchSummaryPath
        totalTokenSavings = $comparisonSummary.comparison.smartsearchVsBaselineTotalTokenSavings
    }
    Add-BenchmarkEvent -EventsPath $runContext.EventsPath -Type "run.complete" -Data @{
        runRoot = $runContext.RunRoot
        comparisonSummaryPath = $comparisonSummaryPath
    }

    Write-Host "" -ForegroundColor Green
    Write-Host "Benchmark complete: $($taskDefinition.Id)" -ForegroundColor Green
    Write-Host "Run root: $($runContext.RunRoot)" -ForegroundColor Green
    Write-Host "Baseline summary: $baselineSummaryPath" -ForegroundColor Green
    Write-Host "NanoContext summary: $nanocontextSummaryPath" -ForegroundColor Green
    Write-Host "NanoContext Smart Search summary: $nanocontextSmartSearchSummaryPath" -ForegroundColor Green
    Write-Host "Comparison summary: $comparisonSummaryPath" -ForegroundColor Green

    return $comparisonSummary
}
