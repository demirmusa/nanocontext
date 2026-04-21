# NanoContext Benchmark Plan

Measures the impact of NanoContext on AI agent token consumption and task accuracy across real-world open-source projects.

## Overview

Each task is executed twice on the same project:
- **Baseline** — Agent works without NanoContext (raw file reads only)
- **NanoContext** — Agent has access to NanoContext MCP tools

Primary metric: **total tokens consumed** (input + output) for the same task.

## Test Projects

| ID | Project | Language | Size | Stars | Why |
|----|---------|----------|------|-------|-----|
| TS-S | [express](https://github.com/expressjs/express) | TypeScript/JS | ~200 files | 66k+ | The most widely known Node.js framework |
| TS-L | [NestJS](https://github.com/nestjs/nest) | TypeScript | ~1000 files | 69k+ | Popular enterprise-grade framework |
| CS-S | [Dapper](https://github.com/DapperLib/Dapper) | C# | ~100 files | 17k+ | Most popular micro-ORM in .NET |
| CS-L | [eShop](https://github.com/dotnet/eShop) | C# | ~500 files | 25k+ | Microsoft's reference architecture |

## Setup

### 1. Clone all projects

```bash
mkdir benchmark-repos && cd benchmark-repos

git clone --depth 1 https://github.com/expressjs/express.git
git clone --depth 1 https://github.com/nestjs/nest.git
git clone --depth 1 https://github.com/DapperLib/Dapper.git
git clone --depth 1 https://github.com/dotnet/eShop.git
```

### 2. Prepare NanoContext for each project

Run this for each project **before** starting NanoContext test runs:

```bash
cd <project-dir>
nc init          # select appropriate language, choose Ollama or another provider
nc scan          # full index
nc status        # verify indexing worked
```

### 3. Tool: Claude Code (CLI)

Claude Code provides the clearest token measurement via `/cost`.

```bash
# Install if not already installed
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

## Test Scenarios

### TS-S: Express

#### Task 1 — Bug Investigation (Read-Heavy)

> **Prompt:** "Express's `res.redirect()` method handles both relative and absolute URLs. Trace the full code path of `res.redirect('/users')` from the moment it's called to the final HTTP response being sent. Show me every function involved, what file it's in, and what each step does."

#### Task 2 — Feature Implementation (Read + Write)

> **Prompt:** "Add a `req.startedAt` property that records `Date.now()` when the request begins, and a `res.elapsed()` method that returns the milliseconds since `req.startedAt`. Implement this as built-in middleware that runs automatically for every request. Modify the necessary source files."

#### Task 3 — Cross-Cutting Understanding

> **Prompt:** "How does Express's error handling work end-to-end? Find all the places where errors are caught, passed to `next(err)`, and ultimately handled. List every file and function involved in the error propagation chain."

---

### TS-L: NestJS

#### Task 1 — Bug Investigation (Read-Heavy)

> **Prompt:** "Trace how a `@Get()` decorated controller method receives a request. Start from the HTTP server receiving the request, through the NestJS routing layer, middleware, guards, interceptors, pipes, and finally the controller method. Map every class and method involved with file locations."

#### Task 2 — Feature Implementation (Read + Write)

> **Prompt:** "Add a new `@Timeout(ms)` decorator for controller methods that automatically returns a 408 Request Timeout if the handler doesn't complete within the specified milliseconds. Implement it as a proper NestJS interceptor with decorator. Write the decorator, interceptor, and register it correctly."

#### Task 3 — Cross-Cutting Understanding

> **Prompt:** "Explain NestJS's dependency injection container implementation. How does `@Injectable()` register a class? How does the container resolve circular dependencies? Find the actual source files that implement the DI container, the resolution algorithm, and the scope handling (DEFAULT, REQUEST, TRANSIENT)."

---

### CS-S: Dapper

#### Task 1 — Bug Investigation (Read-Heavy)

> **Prompt:** "Trace how `connection.QueryAsync<User>("SELECT * FROM Users WHERE Id = @Id", new { Id = 1 })` works internally. From the extension method call through SQL parameter binding, command execution, and object mapping back to a `User` instance. Map every class and method with file locations."

#### Task 2 — Feature Implementation (Read + Write)

> **Prompt:** "Add a built-in `DateOnly` and `TimeOnly` type handler to Dapper so that these types work automatically without users having to register custom handlers. Implement the handlers and register them in the default type handler map."

#### Task 3 — Cross-Cutting Understanding

> **Prompt:** "How does Dapper's object mapping work? When a SQL query returns columns, how does Dapper map them to C# object properties? Find the IL generation / emit code that creates the mapping function. Map every class and method involved with file locations."

---

### CS-L: eShop

#### Task 1 — Bug Investigation (Read-Heavy)

> **Prompt:** "Trace the complete flow of placing an order in eShop. Start from the API endpoint that receives the order request, through validation, domain events, integration events, and database persistence. Map every service, handler, and event involved with file locations."

#### Task 2 — Feature Implementation (Read + Write)

> **Prompt:** "Add a discount coupon feature to the Basket service. A coupon has a code (string) and a percentage discount (decimal). Add: 1) A coupon entity, 2) An endpoint to apply a coupon code to a basket, 3) Validation that the coupon exists and isn't expired, 4) Apply the discount when calculating basket totals."

#### Task 3 — Cross-Cutting Understanding

> **Prompt:** "How does eShop implement the saga/process manager pattern for order processing? Find all integration events, event handlers, and state transitions involved in taking an order from 'submitted' to 'shipped'. Map the entire event flow across all microservices."

---

## Execution Protocol

### For each test run:

```
Project: ______    Task: ______    Condition: [ ] Baseline  [ ] NanoContext
```

#### Baseline Run (No NanoContext)

1. Open a **new** Claude Code session in the project directory:
   ```bash
   cd <project-dir>
   claude
   ```

2. **Verify no MCP access**: If NanoContext MCP config exists, temporarily rename it:
   ```bash
   # Before baseline test
   mv .mcp.json .mcp.json.bak            # Claude Code
   mv .vscode/mcp.json .vscode/mcp.json.bak  # VS Code
   ```

3. Paste the task prompt **exactly as written** above.

4. Let the agent complete the task fully. Do not provide hints or corrections.

5. When done, type `/cost` and record:
   - Input tokens
   - Output tokens
   - Total tokens
   - Cache read tokens (if shown)

6. Note the number of file reads the agent performed (count `Read file` tool calls in the conversation).

7. Rate task success: **0** (failed), **0.5** (partial), **1** (correct and complete).

8. Exit: `/exit`

#### NanoContext Run

1. Restore MCP config if renamed:
   ```bash
   mv .mcp.json.bak .mcp.json
   mv .vscode/mcp.json.bak .vscode/mcp.json
   ```

2. Ensure index is fresh:
   ```bash
   nc status  # verify files are indexed
   ```

3. Open a **new** Claude Code session:
   ```bash
   cd <project-dir>
   claude
   ```

4. Paste the **exact same** task prompt.

5. Let the agent complete. Do not provide hints.

6. `/cost` → record tokens.

7. Note file reads vs NanoContext tool calls.

8. Rate success. Exit.

### Repeat each run 2 times

LLMs are non-deterministic. Run each condition at least **2 times** and average the results.

Total runs: `4 projects × 3 tasks × 2 conditions × 2 repetitions = 48 runs`

If time is limited, do **1 repetition** (24 runs) or pick **2 projects** (12 runs).

## Recording Template

Copy this table for each project and fill in as you go:

### Project: `___________`

| Task | Condition | Run | Input Tokens | Output Tokens | Total Tokens | File Reads | NC Tool Calls | Success (0/0.5/1) | Notes |
|------|-----------|-----|-------------|---------------|--------------|------------|---------------|-------------------|-------|
| T1 | Baseline | 1 | | | | | — | | |
| T1 | Baseline | 2 | | | | | — | | |
| T1 | NanoCtx | 1 | | | | | | | |
| T1 | NanoCtx | 2 | | | | | | | |
| T2 | Baseline | 1 | | | | | — | | |
| T2 | Baseline | 2 | | | | | — | | |
| T2 | NanoCtx | 1 | | | | | | | |
| T2 | NanoCtx | 2 | | | | | | | |
| T3 | Baseline | 1 | | | | | — | | |
| T3 | Baseline | 2 | | | | | — | | |
| T3 | NanoCtx | 1 | | | | | | | |
| T3 | NanoCtx | 2 | | | | | | | |

## Expected Results Format

After all runs, summarize in this format:

### Token Savings Summary

| Project | Task Type | Baseline Avg Tokens | NanoContext Avg Tokens | Savings % | Baseline Success | NC Success |
|---------|-----------|--------------------|-----------------------|-----------|-----------------|------------|
| express | Read-Heavy | | | | | |
| express | Read+Write | | | | | |
| express | Cross-Cut | | | | | |
| NestJS | Read-Heavy | | | | | |
| ... | ... | | | | | |

### Aggregate

| Metric | Baseline | NanoContext | Change |
|--------|----------|------------|--------|
| Avg total tokens per task | | | -__% |
| Avg file reads per task | | | -__% |
| Task success rate | | | +__% |
| Avg input tokens | | | -__% |
| Avg output tokens | | | -__% |

## Tips

- **Same model**: Make sure Claude Code is using the same model for all runs. Check with `/model`.
- **Clean sessions**: Always start a fresh session. Previous context skews results.
- **No hints**: Do not guide the agent. Identical prompts, no follow-ups.
- **Large projects first**: If you're short on time, NanoContext's advantage is most visible on larger projects (NestJS, eShop). Prioritize those.
- **Watch for caching**: Claude's `/cost` shows cache read tokens separately. Note them but focus on total tokens.
- **Read-heavy tasks show the biggest difference**: The agent without NanoContext has to read many files to find what it needs. With NanoContext, a `search` call replaces 10+ file reads.
