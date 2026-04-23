const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenAILLMProvider } = require('../dist/core/llm/providers/OpenAILLMProvider');
const { SearchService } = require('../dist/core/services/SearchService');
const { CodeReadService } = require('../dist/core/services/CodeReadService');
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

  assert.equal(result.matchReason.includes('QueryAsync<T>'), true);
  assert.equal(result.suggestedNext, 'nc get Dapper/SqlMapper.Async.cs[414-483]');
  assert.equal(result.suggestedNextConfidence, 0.95);
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

test('search service escalates repeated empty exact misses to semantic fallback', async () => {
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
  const second = await service.execute({ mode: 'exact', query: 'FindUser<T>' });

  assert.equal(first.length, 0);
  assert.equal(second.length, 1);
  assert.equal(second[0].matchReason.includes('Repeated exact miss'), true);
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
      searchExact: (query) => query === 'AuthService.BuildToken'
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

  const fileScoped = await codeReadService.readSymbolSnippet('src/auth/AuthService.cs#BuildToken');
  assert.equal(fileScoped.target.file, 'src/auth/AuthService.cs');
  assert.equal(fileScoped.target.loc, '6-8');
  assert.match(fileScoped.snippet.content, /return "token";/);

  const indexed = await codeReadService.readSymbolSnippet('AuthService.BuildToken');
  assert.equal(indexed.target.sig, 'string BuildToken()');
  assert.match(indexed.snippet.content, /BuildToken/);
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
  assert.ok(open.snippet.content.length >= peek.snippet.content.length);
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
