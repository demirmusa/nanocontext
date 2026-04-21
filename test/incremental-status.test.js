const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SqliteStateStore } = require('../dist/core/storage/SqliteStateStore');
const { SyncService } = require('../dist/core/pipeline/SyncService');
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
