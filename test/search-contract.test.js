const test = require('node:test');
const assert = require('node:assert/strict');

const { SearchEngine } = require('../dist/core/search/SearchEngine');
const { SearchService } = require('../dist/core/services/SearchService');
const { applyHeaderIdentity } = require('../dist/core/identity/recordIds');

const logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

test('search service clamps limit and routes deep regex through the shared backend', async () => {
  const calls = [];
  const service = new SearchService(
    {
      search: async () => [],
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async (_pattern, limit) => {
        calls.push(limit);
        return [{ type: 'method', file: 'src/example.ts', method: 'run' }];
      },
    },
    {
      loadProjectConfig: async () => ({
        version: 1,
        languages: [],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 3, maxLimit: 4 },
        dependencyDepth: 1,
      }),
      loadUserConfig: async () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
      saveProjectConfig: async () => {},
      saveUserConfig: async () => {},
      getProjectRoot: () => '',
      isInitialized: () => true,
      getDefaultProjectConfig: () => ({
        version: 1,
        languages: [],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 3, maxLimit: 4 },
        dependencyDepth: 1,
      }),
      getDefaultUserConfig: () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
    },
  );

  const results = await service.execute({ mode: 'regex', query: 'run', deep: true, limit: 99 });
  assert.equal(calls[0], 4);
  assert.equal(results.length, 1);
});

test('search service reranks vector candidates with smart search when enabled in config', async () => {
  const calls = [];
  const service = new SearchService(
    {
      search: async (_query, limit) => {
        calls.push(limit);
        return [
          { type: 'method', id: 'method:1', file: 'src/a.ts', method: 'first', loc: '1-4' },
          { type: 'method', id: 'method:2', file: 'src/b.ts', method: 'second', loc: '5-8' },
          { type: 'class', id: 'class:3', file: 'src/c.ts', class: 'Third', loc: '10-18' },
          { type: 'memory', id: 'mem:4', text: 'vector memory result' },
          { type: 'method', id: 'method:5', file: 'src/d.ts', method: 'fifth', loc: '20-30' },
          { type: 'method', id: 'method:6', file: 'src/e.ts', method: 'sixth', loc: '31-40' },
        ];
      },
      searchDeep: async () => [],
      searchExact: () => [],
      searchRegex: () => [],
      searchRegexDeep: async () => [],
    },
    {
      loadProjectConfig: async () => ({
        version: 1,
        languages: [],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 2, maxLimit: 4, smartSearchEnabled: true, smartSearchCandidateMultiplier: 3 },
        dependencyDepth: 1,
      }),
      loadUserConfig: async () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
      saveProjectConfig: async () => {},
      saveUserConfig: async () => {},
      getProjectRoot: () => '',
      isInitialized: () => true,
      getDefaultProjectConfig: () => ({
        version: 1,
        languages: [],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 2, maxLimit: 4, smartSearchEnabled: true, smartSearchCandidateMultiplier: 3 },
        dependencyDepth: 1,
      }),
      getDefaultUserConfig: () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
    },
    {
      name: 'fake-llm',
      isAvailable: async () => true,
      generateFileInsights: async () => ({ insights: [], rawResponse: '' }),
      selectRelevantSearchResults: async (_query, candidates, limit) => {
        assert.equal(limit, 2);
        assert.equal(candidates.length, 6);
        return { selectedIds: [candidates[2].id, candidates[0].id], rawResponse: '' };
      },
    },
  );

  const results = await service.execute({ mode: 'vector', query: 'rerank me', limit: 2, typeFilter: 'all' });
  assert.deepEqual(calls, [6]);
  assert.deepEqual(results.map(result => result.id ?? result.text), ['class:3', 'method:1']);
});

test('search engine honors type filters and final limits', async () => {
  let vectorSearchCalls = 0;
  const searchEngine = new SearchEngine(
    {
      initialize: async () => {},
      upsert: async () => {},
      remove: async () => {},
      removeByFile: async () => {},
      search: async () => {
        vectorSearchCalls++;
        return [
          { type: 'method', id: 'method:1', file: 'src/example.ts', method: 'run', loc: '1-2' },
          { type: 'memory', id: 'mem_1', text: 'duplicate memory' },
        ];
      },
      clear: async () => {},
      count: async () => 0,
    },
    {
      name: 'fake',
      dimensions: 1,
      embed: async () => [0],
    },
    {
      read: async () => null,
      write: async () => {},
      remove: async () => {},
      exists: () => false,
      getHeaderPath: () => '',
    },
    {
      add: async () => { throw new Error('not used'); },
      list: async () => [],
      remove: async () => false,
      removeBefore: async () => 0,
      findSimilar: async () => [
        { id: 'mem_1', text: 'duplicate memory', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'mem_2', text: 'second memory', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      close: () => {},
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
      searchExact: () => [],
      searchRegex: () => [],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    logger,
    3,
  );

  const memoryOnly = await searchEngine.search('memory', 1, 'memory');
  assert.equal(vectorSearchCalls, 0);
  assert.deepEqual(memoryOnly.map(result => result.id), ['mem_1']);

  const allResults = await searchEngine.search('all', 2);
  assert.equal(allResults.length, 2);
  assert.deepEqual(allResults.map(result => result.id ?? result.text), ['method:1', 'mem_1']);
});

test('search engine combines exact lexical regex vector and memory signals with exact boosts', async () => {
  const searchEngine = new SearchEngine(
    {
      initialize: async () => {},
      upsert: async () => {},
      remove: async () => {},
      removeByFile: async () => {},
      search: async () => [
        { type: 'method', id: 'semantic:generic', file: 'src/generic.ts', method: 'render', loc: '1-5', score: 0.05 },
        { type: 'method', id: 'method:target', file: 'src/auth/AuthService.ts', class: 'AuthService', method: 'issueToken', loc: '20-30', sig: 'issueToken(userId: string)', score: 0.35 },
      ],
      clear: async () => {},
      count: async () => 0,
    },
    {
      name: 'fake',
      dimensions: 1,
      embed: async () => [0],
    },
    {
      read: async () => null,
      write: async () => {},
      remove: async () => {},
      exists: () => false,
      getHeaderPath: () => '',
    },
    {
      add: async () => { throw new Error('not used'); },
      list: async () => [{ id: 'mem_auth', text: 'issue token uses AuthService', createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth/AuthService.ts' }],
      listByFile: async () => [],
      listBySymbol: async () => [],
      remove: async () => false,
      removeBefore: async () => 0,
      findSimilar: async () => [{ id: 'mem_auth', text: 'issue token uses AuthService', createdAt: '2026-01-01T00:00:00.000Z', file: 'src/auth/AuthService.ts' }],
      close: () => {},
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
      searchExact: () => [{ type: 'method', id: 'method:target', file: 'src/auth/AuthService.ts', class: 'AuthService', method: 'issueToken', loc: '20-30', sig: 'issueToken(userId: string)' }],
      searchLexical: () => [{ type: 'method', id: 'method:target', file: 'src/auth/AuthService.ts', class: 'AuthService', method: 'issueToken', loc: '20-30', sig: 'issueToken(userId: string)', score: 0.9 }],
      searchRegex: () => [{ type: 'method', id: 'method:target', file: 'src/auth/AuthService.ts', class: 'AuthService', method: 'issueToken', loc: '20-30', sig: 'issueToken(userId: string)' }],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    logger,
    5,
  );

  const results = await searchEngine.search('AuthService issueToken', 3);
  assert.equal(results[0].id, 'method:target');
  assert.match(results[0].matchReason, /signals=exact\+lexical\+regex\+vector/);
  assert.equal(typeof results[0].score, 'number');
  assert.equal(results.filter(result => result.id === 'method:target').length, 1);
  assert.ok(results.some(result => result.type === 'memory'));
});

test('regex deep enriches shallow regex hits with header data', async () => {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'run', class: 'Worker', loc: '5-9', sig: 'run(id: string)', refs: ['persist'], insight: 'runner' },
    ],
    imports: [],
    exports: [],
  });

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
      read: async () => header,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      add: async () => { throw new Error('not used'); },
      list: async () => [],
      remove: async () => false,
      removeBefore: async () => 0,
      findSimilar: async () => [],
      close: () => {},
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
      searchExact: () => [],
      searchRegex: () => [{ type: 'method', id: header.methods[0].id, file: header.file, method: 'run' }],
      getStats: () => ({ totalFiles: 0, totalMethods: 0, lastScanAt: null }),
      setLastScanAt: () => {},
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    logger,
    3,
  );

  const [result] = await searchEngine.searchRegexDeep('run');
  assert.equal(result.class, 'Worker');
  assert.equal(result.sig, 'run(id: string)');
  assert.deepEqual(result.refs, ['persist']);
  assert.equal(result.insight, 'runner');
});
