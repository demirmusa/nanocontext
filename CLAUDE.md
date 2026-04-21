# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
npm run build          # TypeScript → dist/
npm run dev            # Watch mode (tsc --watch)
npm run clean          # Remove dist/
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
```

No test framework configured yet. Node.js >= 18.0.0 required.

## Architecture

### DI Container (`src/core/Container.ts`)

Manual dependency injection with lazy singleton getters. All services composed here. After `initialize()`, provider-dependent services (pipelines, search engine, memory store) are reset to pick up newly created LLM/embedding providers.

### Three-Phase Pipeline (`src/core/pipeline/StructurePipeline.ts`)

1. **Structure** — Tree-sitter AST parsing → `.header.json` files + SQLite search index + checksum tracking
2. **Insight** — Optional LLM-powered keyword generation for methods (concurrent pool)
3. **Vectors** — Embedding generation stored in LanceDB (concurrent pool)

Concurrency for phases 2-3 controlled by `aiInsightConcurrency` in project config. Only changed files are processed (checksum-based).

### Provider Pattern

LLM and embedding providers are pluggable via factory pattern:
- `LLMProviderFactory` — Ollama, OpenAI, Anthropic
- `EmbeddingProviderFactory` — Ollama, OpenAI

Both are optional. Without them, structure phase still works (deterministic AST parsing). Search falls back to exact text mode.

### Storage Layer

- **SqliteStateStore** — Checksums, insight queue, search index, scan stats
- **HeaderStore** — `.header.json` files under `.nanocontext/headers/`
- **LanceVectorStore** — Vector embeddings in LanceDB

### Search Modes

- **Vector** (`search`) — Semantic similarity via embeddings
- **Exact** (`searchExact`) — SQLite LIKE on names, signatures, insights (always available)
- **Regex** (`searchRegex`) — SQLite REGEXP on names, signatures, insights (custom JS function registered at init)
- **Deep** (`searchDeep`) — Vector search enriched with full header data

### Parser Registry

Tree-sitter WASM-based parsers registered by file extension. New languages: extend `BaseLanguageParser`, implement `extractClasses/Methods/Imports/Exports`, register in `ParserRegistry`.

### MCP Server (`src/mcp/McpServer.ts`)

14 tools + 3 resources for AI agent integration. Stdio transport. Short tool names for token efficiency (e.g. `search`, `header`, `code`, `deps`). Each tool delegates to Container services.

### CLI Commands

Commands with aliases: `search` → `s`, `get` → `g`. The `get` command reads file lines: `nc g file.ts[10-20]`.

### Init System (`src/cli/commands/init/`)

Agent-based architecture with `IAgentInitializer` interface. Each agent (VS Code, Claude, Cursor, Windsurf, Gemini, Codex) has its own initializer under `init/initializers/` handling MCP config and agent instruction file setup.

## Key Interfaces (`src/core/interfaces/`)

All contracts defined as TypeScript interfaces. `types.ts` has shared schemas: `HeaderJson`, `MethodInfo`, `ClassInfo`, `SearchResult`, `ProjectConfig`, etc.

## Configuration

- `nanocontextconfig.json` — Project config (git-tracked): languages, include/exclude globs, aiInsight toggle
- `.nanocontext/config.json` — User config (gitignored): LLM/embedding provider settings, API keys
- `.nanocontextignore` — Gitignore-style exclusion patterns

## Conventions

- TypeScript strict mode with `noUnusedLocals`, `noUnusedParameters` (prefix unused with `_`)
- Target: ES2022, Module: CommonJS
- `@typescript-eslint/no-explicit-any`: warn level
- CLI uses Commander.js, entry point: `src/cli/index.ts`
- Public API exports only `Container` and interfaces from `src/index.ts`
