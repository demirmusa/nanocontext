const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SqliteStateStore } = require('../dist/core/storage/SqliteStateStore');
const { SyncService } = require('../dist/core/pipeline/SyncService');
const { StaleService } = require('../dist/core/services/StaleService');
const { ScanManifestService } = require('../dist/core/services/ScanManifestService');
const { createTempProject } = require('./helpers/project');

const logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

test('state stats derive method totals from the live search index', async (t) => {
  const projectRoot = createTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const stateStore = new SqliteStateStore(projectRoot);
  await stateStore.initialize();

  stateStore.setChecksum('src/example.ts', 'sum');
  stateStore.indexMethod('method:1', 'src/example.ts', 'run', undefined, 'run()', '1-2', undefined);
  stateStore.indexClass('class:1', 'src/example.ts', 'Worker', '1-10', undefined);

  const stats = stateStore.getStats();
  assert.equal(stats.totalFiles, 1);
  assert.equal(stats.totalMethods, 1);

  stateStore.removeFileIndex('src/example.ts');
  assert.equal(stateStore.getStats().totalMethods, 0);
  stateStore.close();
});

test('sync service updates last scan time for unchanged incremental syncs', async (t) => {
  const projectRoot = createTempProject({
    'src/example.ts': 'export function run() { return 1; }\n',
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const events = [];
  const filePath = 'src/example.ts';
  const source = fs.readFileSync(path.join(projectRoot, filePath), 'utf-8');

  const syncService = new SyncService(
    {
      processFile: async () => { throw new Error('not used'); },
      processProject: async () => {},
      generateInsightsForFile: async () => null,
      syncVectorsForFile: async () => {},
    },
    {
      read: async () => null,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      initialize: async () => {},
      getChecksum: () => require('../dist/utils/checksum').computeChecksum(source),
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
      setLastScanAt: (value) => { events.push(value); },
      setTotalMethods: () => {},
      clearAll: () => {},
      close: () => {},
    },
    {
      removeByFile: async () => {},
      clear: async () => {},
      count: async () => 0,
      initialize: async () => {},
      upsert: async () => {},
      remove: async () => {},
      search: async () => [],
    },
    {
      getProjectRoot: () => projectRoot,
      isInitialized: () => true,
      loadProjectConfig: async () => ({
        version: 1,
        languages: ['typescript'],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 3, maxLimit: 20 },
        dependencyDepth: 1,
      }),
      loadUserConfig: async () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
      saveProjectConfig: async () => {},
      saveUserConfig: async () => {},
      getDefaultProjectConfig: () => ({
        version: 1,
        languages: ['typescript'],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: false,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 3, maxLimit: 20 },
        dependencyDepth: 1,
      }),
      getDefaultUserConfig: () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
    },
    logger,
    null,
  );

  const result = await syncService.syncFile(filePath);
  assert.equal(result.action, 'unchanged');
  assert.equal(events.length, 1);
});

test('stale service reports categorized index integrity issues with actions', async (t) => {
  const projectRoot = createTempProject({
    'src/example.ts': 'export function run() { return 2; }\n',
    'src/readme.md': '# unsupported\n',
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const service = new StaleService(
    {
      getProjectRoot: () => projectRoot,
      isInitialized: () => true,
      loadProjectConfig: async () => ({
        version: 1,
        languages: ['typescript'],
        include: ['src/**/*'],
        exclude: [],
        aiInsight: true,
        aiInsightConcurrency: 1,
        watch: { debounceMs: 100 },
        search: { defaultLimit: 3, maxLimit: 20 },
        dependencyDepth: 1,
      }),
      loadUserConfig: async () => ({ llm: { provider: 'none', model: 'disabled' }, embedding: { provider: 'none', model: 'disabled' } }),
      saveProjectConfig: async () => {},
      saveUserConfig: async () => {},
      getDefaultProjectConfig: () => ({}),
      getDefaultUserConfig: () => ({}),
    },
    {
      exists: (file) => file === 'src/example.ts',
      read: async (file) => file === 'src/example.ts'
        ? {
          file,
          lang: 'typescript',
          checksum: 'old',
          imports: [],
          exports: [],
          classes: [],
          methods: [{ id: 'method:run', name: 'run', loc: '1-1', sig: 'run()', refs: [] }],
        }
        : null,
      write: async () => {},
      remove: async () => {},
      getHeaderPath: () => '',
    },
    {
      listTrackedFiles: () => ['src/example.ts', 'src/missing.ts', 'src/readme.md'],
      getChecksum: () => 'old-checksum',
      getPendingInsightCount: () => 2,
      getStats: () => ({ totalFiles: 3, totalMethods: 3, lastScanAt: null }),
    },
    {
      count: async () => 1,
    },
  );

  const report = await service.inspect();
  assert.equal(report.ok, false);
  assert.equal(report.stats.changedFiles, 2);
  assert.equal(report.stats.missingFiles, 1);
  assert.equal(report.stats.missingVectors, 2);
  assert.equal(report.stats.staleInsights, 1);
  assert.ok(report.categories.files.some(issue => issue.kind === 'changed-file' && issue.action.includes('nc')));
  assert.ok(report.categories.vectors.some(issue => issue.kind === 'missing-vector'));
  assert.ok(report.categories.parser.some(issue => issue.kind === 'unsupported-extension'));
  assert.ok(report.categories.generation.some(issue => issue.kind === 'scan-generation-mismatch'));
});

test('scan manifest service stores latest generation and marks older generations compactable', async (t) => {
  const projectRoot = createTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const service = new ScanManifestService(projectRoot);
  const first = service.create({
    parserVersion: 'parser-v1',
    vectorSchemaVersion: 'vector-v1',
    embeddingProvider: 'none',
    embeddingModel: 'disabled',
    embeddingDimensions: 0,
    insightPromptVersion: 'insight-v1',
  });
  first.status = 'completed';
  first.finishedAt = new Date().toISOString();
  first.indexedFiles = 1;
  first.files.push({ file: 'src/a.ts', status: 'changed', methods: 1 });
  service.save(first);

  const second = service.create({
    parserVersion: 'parser-v1',
    vectorSchemaVersion: 'vector-v1',
    embeddingProvider: 'none',
    embeddingModel: 'disabled',
    embeddingDimensions: 0,
    insightPromptVersion: 'insight-v1',
  });
  service.save(second);

  assert.equal(service.readLatest().generationId, second.generationId);
  assert.equal(service.readPrevious()[0].generationId, first.generationId);
  assert.equal(service.readPrevious()[0].compactionCandidate, true);
});
