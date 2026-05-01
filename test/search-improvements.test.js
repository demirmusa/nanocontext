const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { OpenAILLMProvider } = require('../dist/core/llm/providers/OpenAILLMProvider');
const { SearchEngine } = require('../dist/core/search/SearchEngine');
const { SearchService } = require('../dist/core/services/SearchService');
const { PrepareService, formatPrepareReport } = require('../dist/core/services/PrepareService');
const { CodeReadService } = require('../dist/core/services/CodeReadService');
const { MemoryService } = require('../dist/core/services/MemoryService');
const { SearchFormatter } = require('../dist/core/search/SearchFormatter');
const { SqliteStateStore } = require('../dist/core/storage/SqliteStateStore');
const { createTempProject } = require('./helpers/project');

function createConfigManager(projectRoot) {
  return {
    getProjectRoot: () => projectRoot,
  };
}

function createMemoryStore(overrides = {}) {
  return {
    add: async () => ({ id: 'mem_1', text: 'note', createdAt: new Date().toISOString() }),
    list: async () => [],
    listByFile: async () => [],
    remove: async () => false,
    removeBefore: async () => 0,
    findSimilar: async () => [],
    close: () => {},
    ...overrides,
  };
}

function createProjectConfig() {
  return {
    version: 1,
    languages: ['typescript'],
    include: ['src/**/*'],
    exclude: [],
    aiInsight: false,
    aiInsightConcurrency: 1,
    watch: { debounceMs: 100 },
    search: { defaultLimit: 3, maxLimit: 10 },
    dependencyDepth: 1,
  };
}

function createSearchConfigManager(overrides = {}) {
  const config = createProjectConfig();
  config.search = { ...config.search, ...overrides };

  return {
    loadProjectConfig: async () => config,
    loadUserConfig: async () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
    saveProjectConfig: async () => {},
    saveUserConfig: async () => {},
    getProjectRoot: () => '',
    isInitialized: () => true,
    getDefaultProjectConfig: () => config,
    getDefaultUserConfig: () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
  };
}

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

test('openai smart rerank omits unsupported temperature from chat completion request', async () => {
  const provider = new OpenAILLMProvider({ apiKey: 'test-key', model: 'gpt-5-mini-2025-08-07' });
  let capturedRequest;

  provider.client = {
    chat: {
      completions: {
        create: async (request) => {
          capturedRequest = request;
          return {
            choices: [
              { message: { content: '{"selectedIds":["candidate-1"]}' } },
            ],
          };
        },
      },
    },
    models: {
      list: async () => ({ data: [] }),
    },
  };

  const result = await provider.selectRelevantSearchResults(
    'query',
    [{ id: 'candidate-1', type: 'method', file: 'src/example.ts', method: 'run', loc: '10-20' }],
    1,
  );

  assert.deepEqual(result.selectedIds, ['candidate-1']);
  assert.equal(capturedRequest.temperature, undefined);
  assert.equal(capturedRequest.model, 'gpt-5-mini-2025-08-07');
});

test('sqlite search index ranks qualified symbols and searches insight refs metadata', async (t) => {
  const projectRoot = createTempProject();

  const stateStore = new SqliteStateStore(projectRoot);
  await stateStore.initialize();
  t.after(() => {
    stateStore.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  stateStore.indexMethod(
    'method:build-token',
    'src/auth/AuthService.ts',
    'BuildToken',
    'AuthService',
    'BuildToken(userId: string): string',
    '10-20',
    'issues refresh token for authenticated users',
    'gen_1',
    {
      namespace: 'Demo.Auth',
      imports: ['import { JwtSigner } from "./jwt"'],
      exports: ['AuthService'],
      refs: ['JwtSigner.sign', 'RefreshToken'],
      parameters: ['userId: string'],
      returnType: 'string',
    },
  );
  stateStore.indexMethod(
    'method:build-report',
    'src/reports/AuthReport.ts',
    'BuildReport',
    'AuthReport',
    'BuildReport(): string',
    '30-40',
    'renders an auth report',
  );

  const [qualified] = stateStore.searchExact('AuthService.BuildToken', 5);
  assert.equal(qualified.id, 'method:build-token');
  assert.equal(qualified.score > 0, true);

  const [insight] = stateStore.searchExact('authenticated users', 5);
  assert.equal(insight.id, 'method:build-token');

  const [refMatch] = stateStore.searchRegex('JwtSigner', 5);
  assert.equal(refMatch.id, 'method:build-token');
});

test('hybrid search matches split camel case symbols through the lexical index', async (t) => {
  const projectRoot = createTempProject();

  const stateStore = new SqliteStateStore(projectRoot);
  await stateStore.initialize();
  t.after(() => {
    stateStore.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  stateStore.indexMethod(
    'method:build-token',
    'src/auth/AuthService.ts',
    'BuildToken',
    'AuthService',
    'BuildToken(userId: string): string',
    '10-20',
    undefined,
  );

  const searchEngine = new SearchEngine(
    {
      initialize: async () => {},
      upsert: async () => {},
      remove: async () => {},
      removeByFile: async () => {},
      search: async () => [],
      clear: async () => {},
      count: async () => 0,
    },
    null,
    {
      read: async () => null,
      write: async () => {},
      remove: async () => {},
      exists: () => false,
      getHeaderPath: () => '',
    },
    createMemoryStore(),
    stateStore,
    logger,
    3,
  );

  const [result] = await searchEngine.search('build token', 1);
  assert.equal(result.id, 'method:build-token');
  assert.deepEqual(result.matchedBy?.includes('name'), true);
});

test('search service normalizes exact misses and attaches suggested next actions', async () => {
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: (query) => query === 'QueryAsync'
        ? [{ type: 'method', file: 'Dapper/SqlMapper.Async.cs', method: 'QueryAsync', loc: '422-475', sig: 'Task QueryAsync<T>()' }]
        : [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
  );

  const [result] = await service.execute({ mode: 'exact', query: 'QueryAsync<T>' });

  assert.equal(result.fallback.mode, 'normalized-exact');
  assert.equal(result.fallback.originalQuery, 'QueryAsync<T>');
  assert.equal(result.suggestedNext, 'nc get Dapper/SqlMapper.Async.cs[414-483]');
  assert.equal(result.suggestedNextConfidence, 0.87);
});

test('search service caches repeated vector requests and only hits the backend once', async () => {
  let calls = 0;
  const service = new SearchService(
    {
      search: async () => {
        calls++;
        return [{ type: 'method', file: 'src/example.ts', method: 'run', loc: '10-14' }];
      },
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager({ smartSearchEnabled: false }),
  );

  await service.execute({ mode: 'vector', query: 'runner', typeFilter: 'all' });
  await service.execute({ mode: 'vector', query: 'runner', typeFilter: 'all' });

  assert.equal(calls, 1);
});

test('search service deterministically falls back to semantic search after exact misses', async () => {
  let semanticCalls = 0;
  const service = new SearchService(
    {
      search: async () => {
        semanticCalls++;
        return [{ type: 'method', file: 'src/example.ts', method: 'findUser', loc: '30-40' }];
      },
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
  );

  const first = await service.execute({ mode: 'exact', query: 'FindUser<T>' });

  assert.equal(first.length, 1);
  assert.equal(first[0].fallback.mode, 'semantic');
  assert.equal(first[0].fallback.from, 'exact');
  assert.equal(first[0].fallback.reason.includes('no exact matches'), true);
  assert.equal(semanticCalls, 1);
});

test('code read service resolves file-scoped and indexed symbol targets', async () => {
  const projectRoot = createTempProject({
    'src/auth/AuthService.cs': [
      'using System;',
      '',
      'namespace Demo;',
      '',
      'public class AuthService {',
      '  public string BuildToken() {',
      '    return "token";',
      '  }',
      '}',
      '',
    ].join('\n'),
  });

  const header = {
    file: 'src/auth/AuthService.cs',
    lang: 'csharp',
    checksum: 'checksum',
    imports: ['System'],
    exports: [],
    classes: [{ id: 'class:auth', name: 'AuthService', loc: '5-9' }],
    methods: [{ id: 'method:token', name: 'BuildToken', class: 'AuthService', loc: '6-8', sig: 'string BuildToken()', refs: [] }],
  };

  const codeReadService = new CodeReadService(
    createConfigManager(projectRoot),
    {
      read: async (file) => file === 'src/auth/AuthService.cs' ? header : null,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      initialize: async () => {},
      getChecksum: () => null,
      listTrackedFiles: () => [],
      setChecksum: () => {},
      removeFile: () => {},
      enqueueInsight: () => {},
      dequeueInsight: () => [],
      completeInsight: () => {},
      failInsight: () => {},
      getPendingInsightCount: () => 0,
      isInsightPending: () => false,
      indexMethod: () => {},
      indexClass: () => {},
      removeFileIndex: () => {},
      searchExact: (query) => query === 'AuthService.BuildToken' || query === 'BuildToken'
        ? [{ type: 'method', file: 'src/auth/AuthService.cs', method: 'BuildToken', class: 'AuthService', loc: '6-8', sig: 'string BuildToken()' }]
        : [],
      searchRegex: () => [],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    createMemoryStore(),
  );

  assert.equal(codeReadService.isLikelyFilePath('src/auth/AuthService.cs'), true);
  assert.equal(codeReadService.isLikelyFilePath('AuthService.BuildToken'), false);
  assert.equal(codeReadService.isLikelyFilePath('AuthService#BuildToken'), false);

  const fileScoped = await codeReadService.readSymbolSnippet('src/auth/AuthService.cs#BuildToken');
  assert.equal(fileScoped.target.file, 'src/auth/AuthService.cs');
  assert.equal(fileScoped.target.loc, '6-8');
  assert.match(fileScoped.snippet.content, /return "token";/);

  const indexed = await codeReadService.readSymbolSnippet('AuthService.BuildToken');
  assert.equal(indexed.target.sig, 'string BuildToken()');
  assert.match(indexed.snippet.content, /BuildToken/);

  const resolution = await codeReadService.resolveSymbolTarget('AuthService.BuildToken');
  assert.equal(resolution.matched.display, 'AuthService#BuildToken');
  assert.equal(resolution.matched.matchType, 'qualified');

  const hashResolution = await codeReadService.resolveSymbolTarget('AuthService#BuildToken');
  assert.equal(hashResolution.matched.file, 'src/auth/AuthService.cs');
  assert.equal(hashResolution.matched.display, 'AuthService#BuildToken');
  assert.equal(hashResolution.matched.matchType, 'qualified');
});

test('code read service reports ambiguity for short symbol queries', async () => {
  const projectRoot = createTempProject({
    'src/auth/AuthService.cs': 'public class AuthService { public string BuildToken() { return "token"; } }',
    'src/user/UserService.cs': 'public class UserService { public string BuildToken() { return "user"; } }',
  });

  const headers = {
    'src/auth/AuthService.cs': {
      file: 'src/auth/AuthService.cs',
      lang: 'csharp',
      checksum: 'checksum-a',
      imports: [],
      exports: [],
      classes: [{ id: 'class:auth', name: 'AuthService', loc: '1-1' }],
      methods: [{ id: 'method:a', name: 'BuildToken', class: 'AuthService', loc: '1-1', sig: 'string BuildToken()', refs: [] }],
    },
    'src/user/UserService.cs': {
      file: 'src/user/UserService.cs',
      lang: 'csharp',
      checksum: 'checksum-b',
      imports: [],
      exports: [],
      classes: [{ id: 'class:user', name: 'UserService', loc: '1-1' }],
      methods: [{ id: 'method:b', name: 'BuildToken', class: 'UserService', loc: '1-1', sig: 'string BuildToken()', refs: [] }],
    },
  };

  const codeReadService = new CodeReadService(
    createConfigManager(projectRoot),
    {
      read: async (file) => headers[file] ?? null,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      initialize: async () => {},
      getChecksum: () => null,
      listTrackedFiles: () => [],
      setChecksum: () => {},
      removeFile: () => {},
      enqueueInsight: () => {},
      dequeueInsight: () => [],
      completeInsight: () => {},
      failInsight: () => {},
      getPendingInsightCount: () => 0,
      isInsightPending: () => false,
      indexMethod: () => {},
      indexClass: () => {},
      removeFileIndex: () => {},
      searchExact: (query) => query === 'BuildToken'
        ? [
          { type: 'method', file: 'src/auth/AuthService.cs', method: 'BuildToken', class: 'AuthService', loc: '1-1', sig: 'string BuildToken()' },
          { type: 'method', file: 'src/user/UserService.cs', method: 'BuildToken', class: 'UserService', loc: '1-1', sig: 'string BuildToken()' },
        ]
        : [],
      searchRegex: () => [],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    createMemoryStore(),
  );

  const resolution = await codeReadService.resolveSymbolTarget('BuildToken');
  assert.equal(resolution.ambiguous, true);
  assert.equal(resolution.candidates.length, 2);
  await assert.rejects(() => codeReadService.openTarget('BuildToken'), /Ambiguous symbol target/);
});

test('code read service exposes peek and open previews with different context sizes', async () => {
  const projectRoot = createTempProject({
    'src/auth/AuthService.cs': [
      'using System;',
      '',
      'namespace Demo;',
      '',
      'public class AuthService {',
      '  public string BuildToken() {',
      '    return "token";',
      '  }',
      '',
      '  public string RefreshToken() {',
      '    return "refresh";',
      '  }',
      '}',
      '',
    ].join('\n'),
  });

  const header = {
    file: 'src/auth/AuthService.cs',
    lang: 'csharp',
    checksum: 'checksum',
    imports: ['System'],
    exports: [],
    classes: [{ id: 'class:auth', name: 'AuthService', loc: '5-13' }],
    methods: [{ id: 'method:token', name: 'BuildToken', class: 'AuthService', loc: '6-8', sig: 'string BuildToken()', refs: [] }],
  };

  const codeReadService = new CodeReadService(
    createConfigManager(projectRoot),
    {
      read: async () => header,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      initialize: async () => {},
      getChecksum: () => null,
      listTrackedFiles: () => [],
      setChecksum: () => {},
      removeFile: () => {},
      enqueueInsight: () => {},
      dequeueInsight: () => [],
      completeInsight: () => {},
      failInsight: () => {},
      getPendingInsightCount: () => 0,
      isInsightPending: () => false,
      indexMethod: () => {},
      indexClass: () => {},
      removeFileIndex: () => {},
      searchExact: () => [{ type: 'method', file: 'src/auth/AuthService.cs', method: 'BuildToken', class: 'AuthService', loc: '6-8', sig: 'string BuildToken()' }],
      searchRegex: () => [],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    createMemoryStore({
      listByFile: async () => [{ id: 'mem_auth', text: 'Auth file note', createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth/AuthService.cs', scope: 'file' }],
    }),
  );

  const peek = await codeReadService.peekTarget('AuthService.BuildToken');
  const open = await codeReadService.openTarget('AuthService.BuildToken');
  const classOpen = await codeReadService.openTarget('AuthService.BuildToken', { classContext: true });
  const aroundSnippet = await codeReadService.readSnippetAround('src/auth/AuthService.cs', '6-8', 2);

  assert.equal(peek.target.loc, '3-11');
  assert.equal(open.target.loc, '1-20');
  assert.equal(classOpen.target.type, 'class');
  assert.equal(classOpen.target.loc, '5-13');
  assert.equal(aroundSnippet.target.loc, '4-10');
  assert.equal(open.memories.length, 1);
  assert.equal(open.memories[0].text, 'Auth file note');
  assert.ok(open.snippet.content.length >= peek.snippet.content.length);
});

test('code read service prefers symbol memories over file memories', async () => {
  const projectRoot = createTempProject({
    'src/auth/AuthService.cs': [
      'public class AuthService {',
      '  public string BuildToken() {',
      '    return "token";',
      '  }',
      '}',
    ].join('\n'),
  });

  const header = {
    file: 'src/auth/AuthService.cs',
    lang: 'csharp',
    checksum: 'checksum',
    imports: [],
    exports: [],
    classes: [{ id: 'class:auth', name: 'AuthService', loc: '1-5' }],
    methods: [{ id: 'method:token', name: 'BuildToken', class: 'AuthService', loc: '2-4', sig: 'string BuildToken()', refs: [] }],
  };

  const codeReadService = new CodeReadService(
    createConfigManager(projectRoot),
    {
      read: async () => header,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      initialize: async () => {},
      getChecksum: () => null,
      listTrackedFiles: () => [],
      setChecksum: () => {},
      removeFile: () => {},
      enqueueInsight: () => {},
      dequeueInsight: () => [],
      completeInsight: () => {},
      failInsight: () => {},
      getPendingInsightCount: () => 0,
      isInsightPending: () => false,
      indexMethod: () => {},
      indexClass: () => {},
      removeFileIndex: () => {},
      searchExact: () => [{ type: 'method', file: 'src/auth/AuthService.cs', method: 'BuildToken', class: 'AuthService', loc: '2-4', sig: 'string BuildToken()' }],
      searchRegex: () => [],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    createMemoryStore({
      listBySymbol: async () => [{ id: 'mem_symbol', text: 'Method note', createdAt: '2026-01-01T00:00:00.000Z', symbol: 'AuthService#BuildToken', symbolId: 'src/auth/AuthService.cs:2-4:method:AuthService#BuildToken', scope: 'symbol' }],
      listByFile: async () => [{ id: 'mem_file', text: 'File note', createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth/AuthService.cs', scope: 'file' }],
    }),
  );

  const open = await codeReadService.openTarget('AuthService.BuildToken');
  assert.equal(open.memories[0].text, 'Method note');
});

test('search service routes natural-language queries through vector search and emits telemetry', async () => {
  let vectorCalls = 0;
  const service = new SearchService(
    {
      search: async () => {
        vectorCalls++;
        return [{ type: 'method', file: 'src/auth.ts', method: 'issueToken', loc: '10-20' }];
      },
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
    null,
    { info() {}, warn() {}, error() {}, debug() {} },
  );

  const [result] = await service.execute({ mode: 'exact', query: 'user authentication token handling' });
  assert.equal(vectorCalls, 1);
  assert.equal(result.searchIntent, 'semantic');
  assert.deepEqual(result.searchTelemetry.fallbackPath, ['intent:semantic', 'vector']);
});

test('smart search reranks natural-language default search before returning results', async () => {
  let vectorLimit = 0;
  const service = new SearchService(
    {
      search: async (_query, limit) => {
        vectorLimit = limit;
        return [
          { type: 'method', id: 'method:generic', file: 'src/generic.ts', method: 'handle', loc: '1-5' },
          { type: 'method', id: 'method:auth', file: 'src/auth.ts', method: 'refreshToken', loc: '10-20', sig: 'refreshToken(user)' },
          { type: 'class', id: 'class:auth', file: 'src/auth.ts', class: 'AuthService', loc: '1-80' },
        ];
      },
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager({ smartSearchEnabled: true, smartSearchCandidateMultiplier: 3 }),
    {
      name: 'fake-llm',
      isAvailable: async () => true,
      generateFileInsights: async () => ({ insights: [], rawResponse: '' }),
      selectRelevantSearchResults: async (_query, candidates, limit) => {
        assert.equal(limit, 1);
        assert.equal(candidates.length, 3);
        return { selectedIds: [candidates[1].id], rawResponse: '' };
      },
    },
    logger,
  );

  const [result] = await service.execute({ mode: 'exact', query: 'user authentication token refresh', limit: 1 });
  assert.equal(vectorLimit, 3);
  assert.equal(result.id, 'method:auth');
  assert.deepEqual(result.searchTelemetry.fallbackPath, ['intent:semantic', 'vector', 'rerank']);
  assert.equal(result.searchTelemetry.rerankUsed, true);
});

test('search formatter prints compact fallback headings before grouped hits', () => {
  const output = SearchFormatter.formatCompact([
    {
      type: 'method',
      file: 'src/auth.ts',
      method: 'findUser',
      loc: '30-40',
      sig: 'findUser(id)',
      fallback: {
        originalQuery: 'FindUser<T>',
        mode: 'semantic',
        from: 'exact',
        reason: 'no exact matches',
      },
      suggestedNext: 'nc get src/auth.ts[22-48]',
    },
  ]);

  assert.match(output, /fallback: semantic from exact for "FindUser<T>" \(no exact matches\)/);
  assert.match(output, /src\/auth\.ts/);
});

test('search formatter explains route matched fields and score parts', () => {
  const output = SearchFormatter.formatExplain('refresh token', [
    {
      type: 'method',
      file: 'src/auth.ts',
      method: 'refreshToken',
      loc: '10-20',
      score: 3.25,
      matchedBy: ['name', 'signature'],
      scoreParts: { lexical: 1.5, vector: 0.7, symbol: 1 },
      matchReason: 'Hybrid match for "refresh token": lexical, vector.',
      suggestedNext: 'nc get src/auth.ts[2-28]',
      searchTelemetry: {
        route: 'intent:semantic',
        fallbackPath: ['intent:semantic', 'vector'],
        rerankUsed: false,
      },
    },
  ]);

  assert.match(output, /Search explain: "refresh token"/);
  assert.match(output, /route: intent:semantic > vector/);
  assert.match(output, /matchedBy: name, signature/);
  assert.match(output, /scoreParts: lexical=1.5, vector=0.7, symbol=1/);
  assert.match(output, /next: nc get src\/auth.ts\[2-28\]/);
});

test('search service attaches explain fields to exact route results', async () => {
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: () => [{ type: 'method', file: 'src/auth.ts', class: 'AuthService', method: 'refreshToken', loc: '10-20', sig: 'refreshToken()' }],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
  );

  const [result] = await service.execute({ mode: 'exact', query: 'refreshToken' });
  assert.deepEqual(result.matchedBy, ['name', 'signature']);
  assert.equal(result.scoreParts.lexical, 1);
  assert.equal(result.scoreParts.symbol, 1);
  assert.equal(result.searchTelemetry.route, 'exact');
});

test('memory service stores and lists symbol-scoped notes', async () => {
  const calls = [];
  const memoryService = new MemoryService(
    {
      add: async (...args) => {
        calls.push(args);
        return { id: 'mem_symbol', text: args[0], createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth/AuthService.cs', symbol: 'AuthService#BuildToken', symbolId: 'src/auth/AuthService.cs:6-8:method:AuthService#BuildToken', scope: 'symbol' };
      },
      list: async (_search, _file, symbolId) => [{ id: 'mem_symbol', text: 'note', createdAt: '2026-01-01T00:00:00.000Z', symbolId, symbol: 'AuthService#BuildToken', file: 'src/auth/AuthService.cs', scope: 'symbol' }],
      listByFile: async () => [],
      listBySymbol: async (symbolId) => [{ id: 'mem_symbol', text: 'note', createdAt: '2026-01-01T00:00:00.000Z', symbolId, symbol: 'AuthService#BuildToken', file: 'src/auth/AuthService.cs', scope: 'symbol' }],
      remove: async () => false,
      removeBefore: async () => 0,
      findSimilar: async () => [],
      close: () => {},
    },
    createSearchConfigManager(),
    {
      resolveSymbolTarget: async () => ({
        query: 'AuthService#BuildToken',
        matched: {
          file: 'src/auth/AuthService.cs',
          symbol: 'AuthService#BuildToken',
          display: 'AuthService#BuildToken',
          loc: '6-8',
          sig: 'string BuildToken()',
          type: 'method',
          matchType: 'qualified',
          confidence: 'high',
        },
        candidates: [],
      }),
    },
  );

  const saved = await memoryService.remember('note', undefined, undefined, 'AuthService#BuildToken');
  const listed = await memoryService.list(undefined, undefined, 'AuthService#BuildToken');

  assert.equal(saved.scope, 'symbol');
  assert.equal(calls[0][3], 'symbol');
  assert.equal(calls[0][4], 'AuthService#BuildToken');
  assert.equal(listed[0].symbol, 'AuthService#BuildToken');
});

test('search service attaches symbol memory hints to matching results', async () => {
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: () => [{ type: 'method', file: 'src/auth.ts', class: 'AuthService', method: 'BuildToken', loc: '10-14', sig: 'BuildToken()' }],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
    null,
    undefined,
    createMemoryStore({
      listBySymbol: async () => [{ id: 'mem_symbol', text: 'Symbol note', createdAt: '2026-01-01T00:00:00.000Z', symbol: 'AuthService#BuildToken', symbolId: 'src/auth.ts:10-14:method:AuthService#BuildToken', scope: 'symbol' }],
      listByFile: async () => [{ id: 'mem_file', text: 'File note', createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth.ts', scope: 'file' }],
    }),
  );

  const [result] = await service.execute({ mode: 'exact', query: 'AuthService.BuildToken' });
  assert.equal(result.memoryHint, 'Symbol note');
});

test('prepare service builds compact task context with warnings memories and next commands', async () => {
  const service = new PrepareService(
    {
      execute: async () => [
        {
          type: 'method',
          file: 'src/auth.ts',
          class: 'AuthService',
          method: 'refreshToken',
          loc: '10-20',
          score: 4,
          suggestedNext: 'nc get src/auth.ts[2-28]',
        },
      ],
    },
    {
      inspect: async () => ({
        ok: false,
        stats: {},
        categories: {},
        issues: [{ kind: 'changed-file', severity: 'high', category: 'files', detail: 'changed', action: 'nc scan' }],
        suggestedNext: ['nc scan'],
      }),
    },
    {
      analyze: async () => ({
        query: 'AuthService#refreshToken',
        callers: [{ symbol: 'Controller#refresh', path: 'src/controller.ts', range: '1-5', confidence: 'high', kind: 'caller' }],
        callees: [],
        trace: [],
        sameFileSymbols: [],
        possibleTests: [{ file: 'test/auth.test.ts', confidence: 'high', reason: 'matches file' }],
        memories: [],
        warnings: [],
        suggestedNext: ['nc callers AuthService#refreshToken'],
      }),
    },
    {
      list: async () => [{ id: 'mem_1', text: 'Refresh token note', createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  );

  const report = await service.prepare('add refresh token support', 3);
  const output = formatPrepareReport(report);

  assert.match(output, /warnings: index stale: 1 changed; run nc scan/);
  assert.match(output, /src\/auth.ts/);
  assert.match(output, /AuthService#refreshToken/);
  assert.match(output, /test\/auth.test.ts/);
  assert.match(output, /Refresh token note/);
  assert.match(output, /nc get src\/auth.ts/);
  assert.doesNotMatch(output, /score=/);
  assert.doesNotMatch(output, /reason="/);
});

test('search service emits search telemetry through debug logging instead of info', async () => {
  const messages = [];
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: () => [{ type: 'method', file: 'src/auth.ts', class: 'AuthService', method: 'BuildToken', loc: '10-14', sig: 'BuildToken()' }],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
    null,
    {
      info(message) { messages.push(['info', message]); },
      warn() {},
      error() {},
      debug(message) { messages.push(['debug', message]); },
    },
  );

  await service.execute({ mode: 'exact', query: 'AuthService.BuildToken' });
  assert.equal(messages.some(([level]) => level === 'info'), false);
  assert.equal(messages.some(([level, message]) => level === 'debug' && String(message).includes('[search]')), true);
});

test('search service clusters related file-local hits under one primary result', async () => {
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: () => [
        { type: 'method', file: 'src/example.ts', class: 'Auth', method: 'a', loc: '10-14', sig: 'a()' },
        { type: 'method', file: 'src/example.ts', class: 'Auth', method: 'b', loc: '15-19', sig: 'b()' },
      ],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    createSearchConfigManager(),
  );

  const results = await service.execute({ mode: 'exact', query: 'Auth' });
  assert.equal(results.length, 1);
  assert.equal(results[0].related.length, 1);
});
