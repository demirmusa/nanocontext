const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { formatCompactSnippetLines } = require('../dist/cli/commands/get');
const { FileDiscoveryService } = require('../dist/core/services/FileDiscoveryService');

test('forget command help keeps the id argument optional', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, 'forget', '--help'], { encoding: 'utf-8' });

  assert.match(output, /Usage: nc forget \[options\] \[id\]/);
  assert.match(output, /--before <date>/);
});

test('cli help exposes header, peek, and open read primitives', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf-8' });

  assert.match(output, /\bheader\b/);
  assert.match(output, /\bpeek\b/);
  assert.match(output, /\bopen\b/);
  assert.match(output, /\bsymbol\b/);
  assert.match(output, /\bfiles\b/);
  assert.match(output, /\brefs\b/);
  assert.match(output, /\bcallers\b/);
  assert.match(output, /\bcallees\b/);
  assert.match(output, /\btrace\b/);
});

test('memory command help exposes file-scoped flags', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const rememberHelp = execFileSync(process.execPath, [cliPath, 'remember', '--help'], { encoding: 'utf-8' });
  const memoriesHelp = execFileSync(process.execPath, [cliPath, 'memories', '--help'], { encoding: 'utf-8' });

  assert.match(rememberHelp, /--file <path>/);
  assert.match(rememberHelp, /--symbol <query>/);
  assert.match(memoriesHelp, /--file <path>/);
  assert.match(memoriesHelp, /--symbol <query>/);
});

test('lookup command help exposes batched query flags', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const searchHelp = execFileSync(process.execPath, [cliPath, 'search', '--help'], { encoding: 'utf-8' });
  const symbolHelp = execFileSync(process.execPath, [cliPath, 'symbol', '--help'], { encoding: 'utf-8' });
  const filesHelp = execFileSync(process.execPath, [cliPath, 'files', '--help'], { encoding: 'utf-8' });

  assert.match(searchHelp, /--query <query\.\.\.>/);
  assert.match(symbolHelp, /--query <query\.\.\.>/);
  assert.match(filesHelp, /--query <query\.\.\.>/);
});

test('get range renderer keeps only first and last line numbers for longer snippets', () => {
  const output = formatCompactSnippetLines('alpha\nbeta\ngamma', 10);

  assert.match(output[0], /10.*alpha/);
  assert.equal(output[1], 'beta');
  assert.match(output[2], /12.*gamma/);
});

test('file discovery service lists and filters indexed files by partial name', () => {
  const service = new FileDiscoveryService({
    listTrackedFiles: () => ['src/AuthService.cs', 'src/UserService.cs', 'README.md'],
  });

  assert.deepEqual(service.list('Service'), ['src/AuthService.cs', 'src/UserService.cs']);
  assert.deepEqual(service.list(), ['README.md', 'src/AuthService.cs', 'src/UserService.cs']);
});
