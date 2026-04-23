<div align="center">

# NanoContext

**AI-first code intelligence for real codebases.**

Tree-sitter AST parsing · Semantic vector search · MCP server for AI agents

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License: Source-available](https://img.shields.io/badge/License-Source--available-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io/)

</div>

---

NanoContext is an AI-first code intelligence layer for your repository. It parses your codebase with tree-sitter, builds a structured index of every class, method, import, and export, and exposes that index to coding agents through MCP or direct CLI workflows.

After `nc init` wires NanoContext into the agents you use and `nc scan` builds the first index, your AI agent can use NanoContext inside that project automatically for search, dependency tracing, exact code reads, and project memory — instead of starting every task with blind file exploration.

**Works with:** VS Code Copilot · Claude Code · Cursor · Windsurf · Gemini CLI · Codex CLI

---

## Quick Start

```bash
# Install
git clone https://github.com/demirmusa/nanocontext.git
cd nanocontext && npm install && npm run build && npm link

# In your project
cd /path/to/your/project
nc init       # interactive setup wizard
nc scan       # index the codebase
nc s "auth"   # search instantly
```

`nc init` sets up agent-specific config and project instructions. `nc scan` builds the first project index. After that, supported agents in this repo can use NanoContext automatically as their code-navigation layer.

## AI-First Workflow

1. `nc init` detects your project, asks which agents you use, and configures NanoContext for that repo.
2. `nc init` writes workspace MCP config or CLI instructions plus agent rule files such as `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, or `.github/copilot-instructions.md`.
3. `nc scan` builds the first structural index, optional vectors, and optional AI insights.
4. Your agent can now enter the repo with NanoContext already wired in, query the codebase before editing, and re-scan after changes.

---

## The Problem

AI coding agents are powerful, but they hit two walls on real-world projects:

**1. Token waste.** An agent exploring a 500-file codebase reads files one by one to understand the structure. Each file read burns tokens. Across a session the same files get re-read multiple times because the agent has no persistent map of what's where. On large projects this adds up fast — slower responses, higher costs, and hitting context limits sooner.

**2. Inconsistency.** Without a structural overview, agents make changes that work locally but break conventions elsewhere. They miss that a helper already exists, duplicate logic, or call a method with the wrong signature — because they never saw the file that defines it. The bigger the project, the worse this gets.

## How NanoContext Fixes This

NanoContext pre-parses your entire codebase into a compact, searchable index that the agent can query instantly — instead of reading raw files:

- **Structure over source** — Instead of reading a 400-line file to find one method signature, the agent queries the index and gets exactly what it needs in a few tokens. Every class, method, import, export, and call reference is extracted by tree-sitter AST parsing (not regex).
- **Search instead of scan** — Semantic vector search, exact text match, and regex let the agent find relevant code in milliseconds across thousands of methods — no need to open files and hope.
- **Persistent memory** — Agents can store and recall project notes, design decisions, and conventions across sessions. No more repeating yourself.
- **Agent-native setup** — `nc init` writes repo-local config and agent instructions so your selected AI tools know NanoContext is part of the workflow from the moment they open the project.
- **Always fresh** — Watch mode auto-indexes files on save. The index stays in sync with your code without manual intervention.

The structure phase is **free and deterministic** — no LLM needed. Optionally enable AI Insight to generate keyword summaries per method for even better search relevance.

---

## Installation

```bash
git clone https://github.com/demirmusa/nanocontext.git
cd nanocontext
npm install
npm run build
npm link        # makes 'nc' available globally
```

**Requirements:** Node.js >= 18.0.0

---

## Usage

### Initialize a project

```bash
cd /path/to/your/project
nc init
```

The wizard walks you through:
1. Choosing how NanoContext will be used in this repo: MCP server or direct CLI
2. Selecting AI agents (VS Code Copilot, Claude, Cursor, Windsurf, Gemini, Codex)
3. Choosing an LLM provider (Ollama, OpenAI, Anthropic, or none)
4. Choosing an embedding provider (Ollama, OpenAI, or none)

It creates:
| File | Purpose | Git |
|------|---------|-----|
| `nanocontextconfig.json` | Languages, include/exclude globs, settings | tracked |
| `.nanocontext/config.json` | API keys, provider config | ignored |
| `.nanocontextignore` | Exclusion patterns (like .gitignore) | tracked |
| `.vscode/mcp.json`, `.mcp.json`, etc. | MCP config per agent (workspace-local, portable) | tracked |
| `.github/copilot-instructions.md`, etc. | Agent instruction files | tracked |

`nc init` also injects a NanoContext section into the selected agent instruction files. In MCP mode, supported agents discover NanoContext as a workspace MCP server automatically. In CLI mode, the generated project rules tell the agent to call `nc` directly. In both modes, the repo itself teaches the agent to use NanoContext before falling back to raw file reads.

### Scan & sync

```bash
nc scan                    # full scan (skips unchanged files)
nc scan -f src/auth.ts     # scan specific file
nc scan --resume           # resume interrupted scan
nc scan --rebuild-vectors  # regenerate all vector embeddings
```

Run `nc scan` once right after `nc init`. That first scan is what turns the setup into usable context for the agent. Before it runs, the integration exists but the project index is still empty.

### Search

```bash
nc s "LoginService"                   # exact text search (default)
nc s "get.*User" -r                   # regex on names/signatures
nc s "authentication logic" -v        # semantic vector search
nc s "database connection" -v -d      # deep vector search (full header data)
nc s "error handling" -l 10           # limit results (default: 3)
```

### Read code

```bash
nc g src/auth/login.ts                # compact file summary
nc g src/auth/login.ts[15-40]         # get lines 15-40 with line numbers
nc peek LoginService.handleLogin      # compact symbol preview
nc open LoginService.handleLogin      # wider symbol preview
nc refs LoginService.handleLogin      # direct refs/callees
nc callers LoginService.handleLogin   # likely inbound refs
nc trace LoginService.handleLogin     # likely call chain
nc inspect src/core/Container.ts      # full parsed structure of a file
```

### Watch for changes

```bash
nc watch                   # auto-index on file save
nc watch stop              # stop from another terminal
```

Watch mode shows real-time progress per pipeline step:

```
14:30:05 src/auth/login.ts → tree-sitter
14:30:05 src/auth/login.ts ✓ +1 ~2 -0
```

### Project memory

```bash
nc remember "Auth uses JWT with RS256 signing"
nc remember "Redis TTL is 5min" --ref "src/cache/redis.ts"
nc remember "This file owns token issuance" -f "src/auth/AuthService.cs"
nc memories                           # list all
nc memories --search "auth"           # search
nc memories --file "src/auth/AuthService.cs"
nc forget mem_abc123                  # delete
nc forget --before 2026-01-01         # bulk delete older memories
```

### Status

```bash
nc status
```

```
NanoContext Status
  Files indexed:     142
  Methods:           1,205
  Vectors:           1,205
  Insight queue:     0
  AI Insight:        enabled
  Languages:         typescript, javascript
```

---

## MCP Integration

### Setup

`nc init` auto-generates MCP config for every agent you select in MCP mode:

| Agent | Config File |
|-------|-------------|
| VS Code Copilot | `.vscode/mcp.json` |
| Claude Code | `.mcp.json` |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Gemini CLI | `.gemini/settings.json` |
| Codex CLI | `.codex/config.toml` |

It also updates the agent's project instruction file so the agent is explicitly told to use NanoContext first, load saved memories at session start, and refresh the index after edits.

Or configure manually:

```json
{
  "mcpServers": {
    "nanocontext": {
      "command": "nc",
      "args": ["mcp-server"]
    }
  }
}
```

### MCP Tools

| Tool | Params | What it does |
|------|--------|--------------|
| `search` | `q`, `n?` | Exact text search on names, signatures, file paths |
| `svec` | `q`, `n?`, `t?` | Semantic vector search. `t`: method / class / memory / all |
| `sdeep` | `q`, `n?` | Vector search with full data (sigs, refs, insights) |
| `sreg` | `p`, `n?` | Regex search on names, signatures, file paths |
| `sregdeep` | `p`, `n?` | Regex search with full data (sigs, refs, insights) |
| `code` | `f`, `loc` | Read source code by line range (e.g. `loc="45-72"`) |
| `deps` | `f`, `m`, `d?` | Get call references of a method (`m` = method name or ID, `d` = depth, max 3) |
| `refs` | `symbol`, `d?` | Get direct refs/callees for a symbol |
| `callers` | `symbol` | Get likely inbound refs for a symbol |
| `trace` | `symbol`, `d?` | Trace a likely execution chain for a symbol |
| `scan` | `f?` | Scan project or a specific file/glob |
| `remember` | `text`, `ref?`, `file?` | Save a note to project memory |
| `memories` | `q?`, `file?`, `id?` | List memories. `file` limits results to one file |
| `forget` | `id` | Delete a memory |
| `status` | — | Indexing statistics |

**Response keys are shortened** for token efficiency: `t`=type, `f`=file, `m`=method, `c`=class, `l`=loc, `s`=score, `sg`=sig, `i`=insight, `r`=refs, `x`=text.

Default search limit is **3**. Pass `n` to override.

### MCP Resources

| URI | Description |
|-----|-------------|
| `nc://status` | Current indexing stats |
| `nc://memories` | All stored memories |
| `nc://headers/{file_path}` | Header data for a specific file |

---

<details>
<summary><h2>Configuration</h2></summary>

### Project Config — `nanocontextconfig.json`

Created by `nc init`. Commit this to git.

```json
{
  "version": 1,
  "languages": ["typescript", "javascript"],
  "include": ["src/**/*.ts", "src/**/*.js"],
  "exclude": ["node_modules", "dist", "*.test.*"],
  "aiInsight": true,
  "watch": { "debounceMs": 500 },
  "search": { "defaultLimit": 3, "maxLimit": 50 },
  "dependencyDepth": 2
}
```

| Field | Description |
|-------|-------------|
| `languages` | Languages to parse: `typescript`, `javascript`, `csharp` |
| `include` | Glob patterns for files to index |
| `exclude` | Glob patterns to skip |
| `aiInsight` | Enable LLM keyword generation (Phase 2) |
| `watch.debounceMs` | File watcher debounce delay (ms) |
| `search.defaultLimit` | Default number of search results |
| `dependencyDepth` | How deep to follow call references |

### User Config — `.nanocontext/config.json`

Gitignored. Stores API keys and provider settings.

```json
{
  "llm": {
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "llama3.2"
  },
  "embedding": {
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "nomic-embed-text"
  }
}
```

### Ignore File — `.nanocontextignore`

Works like `.gitignore`. One pattern per line:

```
node_modules
dist
.git
*.min.js
__tests__
*.spec.ts
```

</details>

---

<details>
<summary><h2>LLM Providers</h2></summary>

### Ollama (Local, Free)

No API key. Runs entirely on your machine.

```bash
# Install: https://ollama.com
ollama pull llama3.2            # LLM
ollama pull nomic-embed-text    # Embeddings
```

### OpenAI

Requires API key (set during `nc init`).

- LLM: `gpt-5-mini-2025-08-07` (recommended)
- Embeddings: `text-embedding-3-small`

### Anthropic

Requires API key. LLM only — use Ollama or OpenAI for embeddings.

- LLM: `claude-haiku-4-5-20251001` (recommended)

### No Provider

Structure phase works completely without any LLM or embedding provider. You get AST parsing, exact text search, and regex search — just no semantic vector search or AI-generated insights.

</details>

---

<details>
<summary><h2>How It Works</h2></summary>

### Two-Phase Pipeline

**Phase 1 — Structure (free, deterministic, no LLM)**

1. Tree-sitter WASM parsers extract classes, methods, imports, exports
2. Method signatures, line ranges, call references, and decorators are captured
3. `.header.json` files are written under `.nanocontext/headers/`
4. SQLite search index is updated for exact/regex search
5. Vector embeddings are generated and stored in LanceDB (if embedding provider configured)

**Phase 2 — Insight (optional, LLM-powered)**

1. Methods are queued for LLM processing
2. Signatures + code are sent to the configured LLM
3. Keyword summaries come back for better search relevance
4. Headers and vectors are updated with insights

### Header File Format

For every source file, a `.header.json` captures its full structure:

```json
{
  "file": "src/auth/login.ts",
  "lang": "typescript",
  "checksum": "a1b2c3d4",
  "classes": [
    {
      "name": "AuthService",
      "loc": "10-85",
      "extends": "BaseService",
      "implements": ["IAuthProvider"],
      "insight": "authentication jwt token validation"
    }
  ],
  "methods": [
    {
      "name": "login",
      "class": "AuthService",
      "loc": "15-40",
      "sig": "public async login(credentials: LoginDto): Promise<AuthToken>",
      "refs": ["validateCredentials", "generateToken", "this.tokenStore.save"],
      "decorators": ["@Post('/login')"],
      "insight": "user login credentials validation token generation"
    }
  ],
  "imports": ["jsonwebtoken", "./token-store", "../models/user"],
  "exports": ["AuthService"]
}
```

### Storage

| Store | Backend | Purpose |
|-------|---------|---------|
| `SqliteStateStore` | better-sqlite3 | Checksums, search index, insight queue, scan stats |
| `HeaderStore` | JSON files | `.header.json` per source file |
| `LanceVectorStore` | LanceDB | Vector embeddings for semantic search |

</details>

---

<details>
<summary><h2>Supported Languages</h2></summary>

| Language | Extensions | Parser |
|----------|-----------|--------|
| TypeScript | `.ts`, `.tsx` | tree-sitter-typescript |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | tree-sitter-javascript |
| C# | `.cs` | tree-sitter-c-sharp |

### Adding a new language

1. Create a parser extending `BaseLanguageParser`:

```typescript
// src/core/parser/languages/MyLangParser.ts
import { BaseLanguageParser } from '../BaseLanguageParser';

export class MyLangParser extends BaseLanguageParser {
  readonly language = 'mylang';
  readonly extensions = ['.ml'];

  protected getWasmFileName(): string {
    return 'tree-sitter-mylang.wasm';
  }

  protected extractClasses(rootNode: any, content: string): ClassInfo[] { /* ... */ }
  protected extractMethods(rootNode: any, content: string): MethodInfo[] { /* ... */ }
  protected extractImports(rootNode: any, content: string): string[] { /* ... */ }
  protected extractExports(rootNode: any, content: string): string[] { /* ... */ }
}
```

2. Register in `ParserRegistry.ts`:

```typescript
this.register(new MyLangParser());
```

3. Ensure the WASM grammar is available in `tree-sitter-wasms`.

</details>

---

<details>
<summary><h2>Project Structure</h2></summary>

```
src/
  cli/                    # CLI entry point (Commander.js)
    commands/             # Command handlers (scan, search, watch, get, init, ...)
      init/               # Agent-based init system
        initializers/     # Per-agent initializers (VSCode, Claude, Cursor, ...)
    utils/                # CLI utilities (colors)
  core/
    config/               # Two-tier config (project + user)
    embedding/            # Embedding providers (Ollama, OpenAI)
    interfaces/           # All TypeScript interfaces and types
    llm/                  # LLM providers (Ollama, OpenAI, Anthropic)
    memory/               # MemoryStore (SQLite + vectors)
    parser/               # Tree-sitter parser registry
      languages/          # Language-specific parsers (TS, JS, C#)
    pipeline/             # Structure + Insight pipelines, SyncService
    search/               # SearchEngine + SearchFormatter
    storage/              # SqliteStateStore, LanceVectorStore, HeaderStore
    watcher/              # FileWatcher (chokidar, lock file, extension filter)
    Container.ts          # DI composition root
  mcp/                    # MCP server (stdio transport)
  utils/                  # Shared utilities (checksum, logger)
```

</details>

---

## License

NanoContext Custom License 1.4.

This project is source-available. Commercial redistribution of NanoContext itself, or of substantially similar derivatives, requires prior written permission. See [LICENSE](LICENSE).
