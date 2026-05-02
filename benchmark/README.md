# Benchmark

This folder contains benchmark runners and shared automation for NanoContext.

## Setup

1. Build NanoContext once from the repo root:

```powershell
npm run build
```

2. Copy the example env file and add your OpenAI key:

```powershell
Copy-Item benchmark/.env.example benchmark/.env
```

Set the `NC_INIT_*` values in `benchmark/.env`, especially:

- `NC_INIT_LLM_API_KEY`
- `NC_INIT_EMBEDDING_API_KEY`

The benchmark scripts load all `nc init` provider settings from `benchmark/.env`.
If you want all Codex benchmark runs to use the same execution model by default, set `CODEX_RUN_MODEL` there as well.

For local Ollama embeddings, set these values in `benchmark/.env`:

```powershell
NC_INIT_EMBEDDING_PROVIDER=ollama
NC_INIT_EMBEDDING_MODEL=nomic-embed-text
NC_INIT_EMBEDDING_ENDPOINT=http://localhost:11434
NC_INIT_EMBEDDING_API_KEY=
```

Make sure the model exists locally first:

```powershell
ollama pull nomic-embed-text
```

You can also start from the Ollama example env:

```powershell
Copy-Item benchmark/.env.ollama.example benchmark/.env
```

For a keyless setup that uses your Codex login for NanoContext LLM calls and local Ollama for embeddings:

```powershell
npm run build
node dist/cli/index.js codex login
Copy-Item benchmark/.env.codex.example benchmark/.env
ollama pull nomic-embed-text
```

This uses NanoContext's own Codex OAuth login stored at `~/.nanocontext/auth.json`; it does not read Codex CLI auth files and does not require an API key.

## Current Flow

- Repositories are cached under `benchmark/repos/_clones`.
- NanoContext-initialized and scanned copies are cached under `benchmark/repos/_nc_indexed_<embedding-provider-model>`.
- Individual benchmark runs write outputs under `benchmark/runs`.
- Each run folder name includes a fresh GUID, so every execution gets isolated baseline and nanocontext workspaces.

The benchmark cache is reused:

- if a repo is already cloned, it is not cloned again
- if a repo is already initialized and scanned for the selected embedding provider/model, `nc init` and `nc scan` are not repeated

Each benchmark run now executes three conditions:

- `baseline`
- `nanocontext`
- `nanocontext-smartsearch`

Then it writes a comparison result file that includes all three.

## Benchmark Scripts

Individual scripts:

```powershell
pwsh -File benchmark/benchmark-express-task1-trace.ps1
pwsh -File benchmark/benchmark-express-task2-feature.ps1
pwsh -File benchmark/benchmark-express-task3-understand.ps1
pwsh -File benchmark/benchmark-nest-task1-trace.ps1
pwsh -File benchmark/benchmark-nest-task2-feature.ps1
pwsh -File benchmark/benchmark-nest-task3-understand.ps1
pwsh -File benchmark/benchmark-dapper-task1-trace.ps1
pwsh -File benchmark/benchmark-dapper-task2-feature.ps1
pwsh -File benchmark/benchmark-dapper-task3-understand.ps1
pwsh -File benchmark/benchmark-eshop-task1-trace.ps1
pwsh -File benchmark/benchmark-eshop-task2-feature.ps1
pwsh -File benchmark/benchmark-eshop-task3-understand.ps1
```

Override the env value for a single run when needed:

```powershell
pwsh -File benchmark/benchmark-dapper-task1-trace.ps1 -Model gpt-5.4-mini
```

Run all:

```powershell
pwsh -File benchmark/benchmark-run-all.ps1
```

## Output Structure

Each run directory contains:

- `logs/run-events.jsonl`
- `baseline/summary.json`
- `baseline/prompt.txt`
- `baseline/command.json`
- `baseline/logs/condition-events.jsonl`
- `baseline/logs/codex-events.jsonl`
- `baseline/logs/codex-stdout.log`
- `baseline/logs/codex-stderr.log`
- `nanocontext/summary.json`
- `nanocontext/prompt.txt`
- `nanocontext/command.json`
- `nanocontext/logs/condition-events.jsonl`
- `nanocontext/logs/codex-events.jsonl`
- `nanocontext/logs/codex-stdout.log`
- `nanocontext/logs/codex-stderr.log`
- `nanocontext-smartsearch/summary.json`
- `nanocontext-smartsearch/prompt.txt`
- `nanocontext-smartsearch/command.json`
- `nanocontext-smartsearch/logs/condition-events.jsonl`
- `nanocontext-smartsearch/logs/codex-events.jsonl`
- `nanocontext-smartsearch/logs/codex-stdout.log`
- `nanocontext-smartsearch/logs/codex-stderr.log`
- `comparison.json`

These files are intended to support a future UI.

While a benchmark is running, the shared logger also writes each orchestration step to the console so you can see cache hits, `nc init`, `nc scan`, workspace preparation, agent start/completion, and summary writes live.

The console stream also mirrors:

- `nc init` stdout/stderr
- `nc scan` stdout/stderr
- Codex stderr
- Codex JSON event stream as readable AI messages, tool executions, command outputs, file changes, and final token usage

The per-condition summaries include:

- prompt path
- workspace path
- executed command
- final answer
- token usage
- command execution records
- file change records
- agent console messages
- raw non-JSON stderr lines

## UI

A small browser UI is available under `benchmark/ui`.

Open `benchmark/ui/index.html` in a Chromium-based browser, click `Select Runs Folder`, and choose the local `benchmark/runs` directory.

The UI reads the result files directly from disk and shows:

- aggregate analytics across all runs grouped by task
- baseline vs NanoContext vs NanoContext Smart Search averages
- a run picker for drilling into one specific run
- per-condition commands, console messages, and file/log paths

## Init Behavior

Benchmark initialization uses non-interactive `nc init` with:

- `NC_INIT_LLM_PROVIDER`
- `NC_INIT_LLM_MODEL`
- `NC_INIT_LLM_API_KEY`
- `NC_INIT_EMBEDDING_PROVIDER`
- `NC_INIT_EMBEDDING_MODEL`
- `NC_INIT_EMBEDDING_ENDPOINT`
- `NC_INIT_EMBEDDING_API_KEY`
- `NC_INIT_MODE`
- `NC_INIT_AGENTS`
- `NC_INIT_SMART_SEARCH`
- `CODEX_RUN_MODEL`

Current defaults in `.env` are:

- OpenAI LLM
- `gpt-5-mini-2025-08-07`
- OpenAI embeddings
- `text-embedding-3-small`
- `cli` init mode
- `codex` agent docs
