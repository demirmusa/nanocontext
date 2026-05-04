const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  formatCompactSnippetLines,
  formatBoundedSnippetLines,
  formatCompactMethodLines,
  formatSymbolCandidateLines,
} = require('../dist/cli/commands/get');
const { buildSearchRequest } = require('../dist/cli/commands/searchRequest');
const { collectQueries, findFileSearchMatches, resolveImplicitBatchLimit } = require('../dist/cli/commands/search');
const { collectFileQueries } = require('../dist/cli/commands/files');
const { FileDiscoveryService } = require('../dist/core/services/FileDiscoveryService');
const { buildIgnoreEntry } = require('../dist/cli/commands/ignore');

test('forget command help keeps the id argument optional', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, 'forget', '--help'], { encoding: 'utf-8' });

  assert.match(output, /Usage: nc forget \[options\] \[id\]/);
  assert.match(output, /--before <date>/);
});

test('cli help exposes header, peek, and get read primitives', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf-8' });

  assert.match(output, /\bheader\b/);
  assert.match(output, /\bpeek\b/);
  assert.match(output, /\bget\b/);
  assert.doesNotMatch(output, /^\s+symbol\b/m);
  assert.match(output, /\bfiles\b/);
  assert.match(output, /\brefs\b/);
  assert.match(output, /\bcallers\b/);
  assert.match(output, /\bcallees\b/);
  assert.match(output, /\btrace\b/);
  assert.match(output, /\bimpact\b/);
  assert.match(output, /\bstale\b/);
  assert.match(output, /\bagent-start\b/);
  assert.match(output, /\bstop\b/);
  assert.match(output, /\bresume\b/);
  assert.match(output, /\bignore\b/);
  assert.match(output, /\bremove\b/);
});

test('init help exposes agent setup flag', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, 'init', '--help'], { encoding: 'utf-8' });

  assert.match(output, /--agent-setup/);
  assert.doesNotMatch(output, /--setup-only/);
});

test('stop and resume toggle embedding config without losing provider settings', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-embedding-toggle-'));
  fs.writeFileSync(
    path.join(projectRoot, 'nanocontextconfig.json'),
    JSON.stringify({
      version: 1,
      languages: ['typescript'],
      include: ['src/**/*'],
      exclude: [],
      aiInsight: false,
      aiInsightConcurrency: 1,
      watch: { debounceMs: 100 },
      search: { defaultLimit: 3, maxLimit: 20, smartSearchEnabled: true },
      dependencyDepth: 1,
    }, null, 2),
    'utf-8',
  );
  fs.mkdirSync(path.join(projectRoot, '.nanocontext'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.nanocontext', 'config.json'),
    JSON.stringify({
      llm: { provider: 'none', model: 'disabled' },
      embedding: {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'text-embedding-3-small',
      },
    }, null, 2),
    'utf-8',
  );

  execFileSync(process.execPath, [cliPath, 'stop'], { cwd: projectRoot, encoding: 'utf-8' });
  const stopped = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nanocontext', 'config.json'), 'utf-8'));
  const stoppedProject = JSON.parse(fs.readFileSync(path.join(projectRoot, 'nanocontextconfig.json'), 'utf-8'));
  assert.equal(stopped.embedding.provider, 'none');
  assert.equal(stopped.pausedEmbedding.provider, 'openai');
  assert.equal(stopped.pausedEmbedding.apiKey, 'test-key');
  assert.equal(stoppedProject.search.smartSearchEnabled, false);
  assert.equal(stoppedProject.search.pausedSmartSearchEnabled, true);

  execFileSync(process.execPath, [cliPath, 'resume'], { cwd: projectRoot, encoding: 'utf-8' });
  const resumed = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nanocontext', 'config.json'), 'utf-8'));
  const resumedProject = JSON.parse(fs.readFileSync(path.join(projectRoot, 'nanocontextconfig.json'), 'utf-8'));
  assert.equal(resumed.embedding.provider, 'openai');
  assert.equal(resumed.embedding.apiKey, 'test-key');
  assert.equal(resumed.pausedEmbedding, undefined);
  assert.equal(resumedProject.search.smartSearchEnabled, true);
  assert.equal(resumedProject.search.pausedSmartSearchEnabled, undefined);
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

test('lookup command help exposes file-scoped and explain flags without query flag', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const searchHelp = execFileSync(process.execPath, [cliPath, 'search', '--help'], { encoding: 'utf-8' });
  const filesHelp = execFileSync(process.execPath, [cliPath, 'files', '--help'], { encoding: 'utf-8' });

  assert.doesNotMatch(searchHelp, /--query/);
  assert.match(searchHelp, /--file <path>/);
  assert.match(searchHelp, /--explain/);
  assert.doesNotMatch(filesHelp, /--query/);
});

test('search explain uses the same default request shape', () => {
  assert.deepEqual(
    buildSearchRequest('auth moderation', {}),
    {
      mode: 'exact',
      query: 'auth moderation',
      limit: 3,
      deep: undefined,
      typeFilter: undefined,
    },
  );
  assert.deepEqual(
    buildSearchRequest('auth moderation', { vector: true, deep: true, limit: '5' }),
    {
      mode: 'vector',
      query: 'auth moderation',
      limit: 5,
      deep: true,
      typeFilter: 'all',
    },
  );
});

test('search query collection splits pipe-delimited batch queries', () => {
  assert.deepEqual(
    collectQueries('SetupCommand|GetTypeDeserializer', ['GetDeserializer|CreateParamInfoGenerator', 'SetupCommand']),
    ['SetupCommand', 'GetTypeDeserializer', 'GetDeserializer', 'CreateParamInfoGenerator'],
  );
});

test('batch search lowers implicit per-query limit but honors explicit limit', () => {
  assert.equal(resolveImplicitBatchLimit(1), 3);
  assert.equal(resolveImplicitBatchLimit(4), 2);
  assert.equal(resolveImplicitBatchLimit(9), 1);
  assert.equal(resolveImplicitBatchLimit(9, '5'), 5);
});

test('files query collection splits pipe-delimited batch queries', () => {
  assert.deepEqual(
    collectFileQueries('AuthService|UserService', ['OrderService']),
    ['AuthService', 'UserService', 'OrderService'],
  );
});

test('file-scoped search limits matching symbols by default and reports truncation', () => {
  const methods = Array.from({ length: 12 }, (_, index) => ({
    name: 'QueryAsync',
    class: 'SqlMapper',
    loc: `${index + 1}-${index + 1}`,
    sig: `public static QueryAsync(${index})`,
  }));
  const content = methods.map(method => method.sig).join('\n');

  const { matches, total, truncated } = findFileSearchMatches([], methods, content, 'QueryAsync');

  assert.equal(matches.length, 5);
  assert.equal(matches.filter(item => item.kind === 'method').length, 5);
  assert.equal(total, 12);
  assert.equal(truncated, true);
});

test('file-scoped search honors explicit limit', () => {
  const methods = Array.from({ length: 12 }, (_, index) => ({
    name: 'QueryAsync',
    class: 'SqlMapper',
    loc: `${index + 1}-${index + 1}`,
    sig: `public static QueryAsync(${index})`,
  }));
  const content = methods.map(method => method.sig).join('\n');

  const { matches, total, truncated } = findFileSearchMatches([], methods, content, 'QueryAsync', 10);

  assert.equal(matches.length, 10);
  assert.equal(total, 12);
  assert.equal(truncated, true);
});

test('file-scoped search also returns raw text matches outside symbol metadata', () => {
  const methods = [{
    name: 'Run',
    class: 'Worker',
    loc: '1-3',
    sig: 'public void Run()',
  }];
  const content = [
    'public void Run()',
    '{',
    '}',
    'const marker = "QueryAsync";',
  ].join('\n');

  const { matches, total, truncated } = findFileSearchMatches([], methods, content, 'QueryAsync');

  assert.deepEqual(matches, [{ kind: 'line', line: 4, text: 'const marker = "QueryAsync";' }]);
  assert.equal(total, 1);
  assert.equal(truncated, false);
});

test('watch command help exposes detached and list modes without stop id', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const watchHelp = execFileSync(process.execPath, [cliPath, 'watch', '--help'], { encoding: 'utf-8' });
  const stopHelp = execFileSync(process.execPath, [cliPath, 'watch', 'stop', '--help'], { encoding: 'utf-8' });

  assert.match(watchHelp, /--detach/);
  assert.match(watchHelp, /--list/);
  assert.match(stopHelp, /Usage: nc watch stop \[options\]/);
  assert.match(stopHelp, /--all/);
  assert.doesNotMatch(stopHelp, /watchId/);
});

test('MCP instructions tell agents about watch but not scan', () => {
  const { AgentSetupService } = require('../dist/core/services/AgentSetupService');
  const instructions = new AgentSetupService().getNanoContextInstructions('mcp');

  assert.match(instructions, /`watch`/);
  assert.doesNotMatch(instructions, /`scan`/);
});

test('get range renderer keeps only first and last line numbers for longer snippets', () => {
  const output = formatCompactSnippetLines('alpha\nbeta\ngamma', 10);

  assert.match(output[0], /10.*alpha/);
  assert.equal(output[1], 'beta');
  assert.match(output[2], /12.*gamma/);
});

test('get range renderer bounds long snippets by default', () => {
  const content = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`).join('\n');
  const output = formatBoundedSnippetLines(content, 1, 10);
  const joined = output.join('\n');

  assert.match(joined, /omitted 110 lines; use --full/);
  assert.match(joined, /line-1/);
  assert.match(joined, /line-120/);
  assert.equal(output.length, 11);
});

test('get file summary limits methods including overloads', () => {
  const methods = [
    ...Array.from({ length: 8 }, (_, index) => ({
      name: `Single${index + 1}`,
      loc: `${index + 1}-${index + 1}`,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      name: 'Load',
      class: 'Mapper',
      loc: `${20 + index}-${20 + index}`,
      sig: `public void Load(int value${index})`,
    })),
  ];

  const output = formatCompactMethodLines(methods, 10);
  const joined = output.join('\n');

  assert.equal(output.filter(line => /Single\d|Load\(int value/.test(line)).length, 10);
  assert.match(joined, /Mapper\.Load: \[4 overload\]/);
  assert.match(joined, /\.\.\./);
  assert.doesNotMatch(joined, /value2/);
});

test('get symbol candidates omit overload count header', () => {
  const output = formatSymbolCandidateLines([
    { sig: 'private static async MultiMapAsync()', loc: '931-950' },
    { sig: 'private static async MultiMapAsync(Type[] types)', loc: '975-998' },
  ]);

  assert.deepEqual(output, [
    'private static async MultiMapAsync()[931-950]',
    'private static async MultiMapAsync(Type[] types)[975-998]',
  ]);
});

test('file discovery service lists and filters indexed files by partial name', () => {
  const service = new FileDiscoveryService({
    listTrackedFiles: () => ['src/AuthService.cs', 'src/UserService.cs', 'README.md'],
  });

  assert.deepEqual(service.list('Service'), ['src/AuthService.cs', 'src/UserService.cs']);
  assert.deepEqual(service.list(), ['README.md', 'src/AuthService.cs', 'src/UserService.cs']);
});

test('ignore command normalizes directories and globs relative to project root', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-ignore-'));
  fs.mkdirSync(path.join(projectRoot, 'mobile', 'wwwroot', 'css', 'fontawesome'), { recursive: true });
  const cwd = path.join(projectRoot, 'mobile');

  assert.equal(
    buildIgnoreEntry('.', projectRoot, cwd),
    'mobile/**',
  );
  assert.equal(
    buildIgnoreEntry(path.join('wwwroot', 'css', 'fontawesome'), projectRoot, cwd),
    'mobile/wwwroot/css/fontawesome/**',
  );
  assert.equal(buildIgnoreEntry('**/*.min.js', projectRoot, cwd), '**/*.min.js');
});
