#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';
import { watchCommand, watchListCommand, watchStopCommand } from './commands/watch';
import { searchCommand } from './commands/search';
import { explainSearchCommand } from './commands/explain-search';
import { inspectCommand } from './commands/inspect';
import { headerCommand } from './commands/header';
import { rememberCommand, memoriesCommand, forgetCommand } from './commands/memory';
import { statusCommand } from './commands/status';
import { mcpServerCommand } from './commands/mcp-server';
import { getCommand } from './commands/get';
import { peekCommand } from './commands/peek';
import { symbolCommand } from './commands/symbol';
import { filesCommand } from './commands/files';
import { refsCommand } from './commands/refs';
import { callersCommand } from './commands/callers';
import { calleesCommand } from './commands/callees';
import { traceCommand } from './commands/trace';
import { clearCommand } from './commands/clear';
import { impactCommand } from './commands/impact';
import { staleCommand } from './commands/stale';
import { ignoreCommand } from './commands/ignore';
import { removeCommand } from './commands/remove';
import { agentStartCommand } from './commands/agent-start';
import { resumeCommand, stopCommand } from './commands/embedding-control';

const program = new Command();

program
  .name('nc')
  .description('NanoContext - AI-powered code context manager')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize NanoContext in current project')
  .option('--llm-provider <provider>', 'LLM provider: ollama | openai | anthropic | none')
  .option('--llm-model <model>', 'LLM model')
  .option('--llm-endpoint <url>', 'LLM endpoint for local providers')
  .option('--llm-api-key <key>', 'LLM API key for cloud providers')
  .option('--embedding-provider <provider>', 'Embedding provider: ollama | openai | none')
  .option('--embedding-model <model>', 'Embedding model')
  .option('--embedding-endpoint <url>', 'Embedding endpoint for local providers')
  .option('--embedding-api-key <key>', 'Embedding API key for cloud providers')
  .option('--smart-search', 'Enable Smart Search')
  .option('--include <globs>', 'Comma-separated include globs')
  .option('--mode <mode>', 'Setup mode: mcp | cli')
  .option('--agents <ids>', 'Comma-separated agent ids (e.g. codex,claude)')
  .option('-y, --yes', 'Overwrite existing init config without prompting')
  .option('--setup-only', 'Only update agent/mode setup, skip provider config prompts')
  .action(initCommand);

program
  .command('scan')
  .description('Scan project or specific files')
  .option('-f, --file <files...>', 'Scan specific files (supports glob)')
  .option('--resume', 'Resume interrupted scan')
  .option('--rebuild-vectors', 'Rebuild vectors from headers')
  .option('--verbose', 'Write detailed AI insight results to scan log')
  .action(scanCommand);

const watchCmd = program
  .command('watch')
  .description('Watch for file changes and auto-sync')
  .option('-d, --detach', 'Run watcher in the background')
  .option('--list', 'List running watch processes')
  .action((options: { detach?: boolean; list?: boolean }) => {
    if (options.list) {
      watchListCommand();
      return;
    }
    void watchCommand(options);
  });

watchCmd
  .command('stop')
  .description('Stop the running watch process')
  .option('--all', 'Stop all running watch processes')
  .action(watchStopCommand);

program
  .command('agent-start')
  .description('Start background indexing and print project memories for agent session startup')
  .action(agentStartCommand);

program
  .command('stop')
  .description('Stop embedding provider calls for this project')
  .action(stopCommand);

program
  .command('resume')
  .description('Resume the previously stopped embedding provider')
  .action(resumeCommand);

program
  .command('search [query]')
  .alias('s')
  .description('Search codebase (exact text by default)')
  .option('-q, --query <query...>', 'Run multiple queries in one command')
  .option('-v, --vector', 'Use vector/semantic search')
  .option('-d, --deep', 'Include full data: sigs, refs, insights (use with -v or -r)')
  .option('-r, --regex', 'Regex search on names/signatures')
  .option('-l, --limit <number>', 'Max results', '3')
  .action(searchCommand);

program
  .command('explain-search <query>')
  .description('Explain search ranking, route, matched fields, and score parts')
  .option('-v, --vector', 'Use vector/semantic search')
  .option('-r, --regex', 'Regex search on names/signatures')
  .option('-l, --limit <number>', 'Max results', '5')
  .action(explainSearchCommand);

program
  .command('get <target>')
  .alias('g')
  .description('Get a compact file summary or raw lines (e.g. nc get myfile.cs, nc get myfile.cs[76-89])')
  .option('--around <lines>', 'Expand ranged or symbol reads by N surrounding lines')
  .action(getCommand);

program
  .command('inspect <file>')
  .description('Show header info for a file')
  .action(inspectCommand);

program
  .command('header <file>')
  .description('Show compact file structure only')
  .action(headerCommand);

program
  .command('peek <target>')
  .description('Show a compact preview for a file or symbol')
  .action(peekCommand);


program
  .command('symbol [query]')
  .description('Resolve a symbol name to ranked candidates')
  .option('-q, --query <query...>', 'Resolve multiple symbol queries in one command')
  .action(symbolCommand);

program
  .command('files [query]')
  .description('List indexed files or search them by partial name')
  .option('-q, --query <query...>', 'Search multiple filename queries in one command')
  .action(filesCommand);

program
  .command('refs <symbol>')
  .description('Show direct refs/callees for a symbol')
  .option('-d, --depth <number>', 'Trace depth')
  .action(refsCommand);

program
  .command('callers <symbol>')
  .description('Show likely inbound references for a symbol')
  .action(callersCommand);

program
  .command('callees <symbol>')
  .description('Show likely outbound calls for a symbol')
  .action(calleesCommand);

program
  .command('trace <symbol>')
  .description('Trace a likely execution chain for a symbol')
  .option('-d, --depth <number>', 'Trace depth')
  .action(traceCommand);

program
  .command('impact <target>')
  .description('Analyze likely impact for a file or symbol')
  .action(impactCommand);

program
  .command('stale')
  .description('Check whether the index is stale')
  .action(staleCommand);

program
  .command('ignore <path>')
  .description('Add a path or glob to .nanocontextignore')
  .action(ignoreCommand);

program
  .command('remove')
  .description('Remove NanoContext setup from this project')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(removeCommand);

program
  .command('remember <text>')
  .description('Add a note to project memory')
  .option('--ref <reference>', 'Optional reference')
  .option('-f, --file <path>', 'Attach the memory to a file')
  .option('--symbol <query>', 'Attach the memory to a symbol')
  .action(rememberCommand);

program
  .command('memories')
  .description('List all memories')
  .option('-s, --search <query>', 'Filter memories')
  .option('-f, --file <path>', 'Only show memories for one file')
  .option('--symbol <query>', 'Only show memories for one symbol')
  .action(memoriesCommand);

program
  .command('forget [id]')
  .description('Delete a memory')
  .option('--before <date>', 'Delete memories before date')
  .action(forgetCommand);

program
  .command('status')
  .description('Show indexing status')
  .action(statusCommand);

program
  .command('clear [target]')
  .description('Clear data (headers, vectors, or all)')
  .action((target?: string) => clearCommand(target || 'all'));

program
  .command('mcp-server')
  .description('Start MCP server')
  .option('--http', 'Use HTTP mode instead of stdio')
  .option('--project <path>', 'Project directory')
  .action(mcpServerCommand);

program.parse();
