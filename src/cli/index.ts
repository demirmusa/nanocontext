#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';
import { watchCommand, watchStopCommand } from './commands/watch';
import { searchCommand } from './commands/search';
import { inspectCommand } from './commands/inspect';
import { rememberCommand, memoriesCommand, forgetCommand } from './commands/memory';
import { statusCommand } from './commands/status';
import { mcpServerCommand } from './commands/mcp-server';
import { getCommand } from './commands/get';
import { clearCommand } from './commands/clear';

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
  .action(watchCommand);

watchCmd
  .command('stop')
  .description('Stop the running watch process')
  .action(watchStopCommand);

program
  .command('search <query>')
  .alias('s')
  .description('Search codebase (exact text by default)')
  .option('-v, --vector', 'Use vector/semantic search')
  .option('-d, --deep', 'Include full data: sigs, refs, insights (use with -v or -r)')
  .option('-r, --regex', 'Regex search on names/signatures')
  .option('-l, --limit <number>', 'Max results', '3')
  .action(searchCommand);

program
  .command('get <target>')
  .alias('g')
  .description('Get lines from a file (e.g. nc get myfile.cs[76-89])')
  .action(getCommand);

program
  .command('inspect <file>')
  .description('Show header info for a file')
  .action(inspectCommand);

program
  .command('remember <text>')
  .description('Add a note to project memory')
  .option('--ref <reference>', 'Optional reference')
  .action(rememberCommand);

program
  .command('memories')
  .description('List all memories')
  .option('-s, --search <query>', 'Filter memories')
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
