const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { StructurePipeline } = require('../dist/core/pipeline/StructurePipeline');
const { computeChecksum } = require('../dist/utils/checksum');
const { createTempProject } = require('./helpers/project');

const logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

test('full scan rebuilds headers even when checksum is unchanged', async (t) => {
  const source = 'export function run() { return 1; }\n';
  const projectRoot = createTempProject({
    'src/example.ts': source,
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const writes = [];
  const pipeline = new StructurePipeline(
    {
      register() {},
      getParser(filePath) {
        if (!filePath.endsWith('.ts')) return null;
        return {
          language: 'typescript',
          extensions: ['.ts'],
          parse: async () => ({
            file: 'src/example.ts',
            lang: 'typescript',
            classes: [],
            methods: [
              { name: 'run', loc: '1-1', sig: 'export function run()', refs: [] },
            ],
            imports: [],
            exports: ['run'],
          }),
        };
      },
      getSupportedLanguages() { return ['typescript']; },
      getSupportedExtensions() { return ['.ts']; },
    },
    {
      getHeaderPath: () => '',
      read: async () => null,
      write: async (_file, header) => { writes.push(header); },
      remove: async () => {},
      exists: () => false,
    },
    {
      initialize: async () => {},
      getChecksum: () => computeChecksum(source),
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
    null,
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
  );

  await pipeline.processProject();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, 'src/example.ts');
  assert.equal(writes[0].methods[0].name, 'run');
});

test('scan skips vector phase when files are unchanged and vectors already exist', async (t) => {
  const source = 'export function run() { return 1; }\n';
  const projectRoot = createTempProject({
    'src/example.ts': source,
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  let vectorSyncs = 0;
  const existingHeader = {
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: computeChecksum(source),
    classes: [],
    methods: [
      { id: 'method:run', name: 'run', loc: '1-1', sig: 'export function run()', refs: [] },
    ],
    imports: [],
    exports: ['run'],
  };

  const pipeline = new StructurePipeline(
    parserRegistryForExample(),
    {
      getHeaderPath: () => '',
      read: async () => existingHeader,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
    },
    stateStoreForExample(source),
    {
      initialize: async () => {},
      upsert: async () => { vectorSyncs++; },
      remove: async () => {},
      removeByFile: async () => { vectorSyncs++; },
      search: async () => [],
      clear: async () => {},
      count: async () => 1,
    },
    {
      name: 'fake',
      dimensions: 1,
      isAvailable: async () => true,
      embed: async () => {
        throw new Error('embedding should not run');
      },
      embedBatch: async () => [],
    },
    null,
    configManagerForExample(projectRoot),
    logger,
  );

  const phases = [];
  await pipeline.processProject(progress => phases.push(progress.phase));

  assert.equal(vectorSyncs, 0);
  assert.ok(!phases.includes('vectors'));
});

test('scan rebuilds vectors from unchanged headers when vector store is empty', async (t) => {
  const source = 'export function run() { return 1; }\n';
  const projectRoot = createTempProject({
    'src/example.ts': source,
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  let embeddings = 0;
  let upserts = 0;
  const existingHeader = {
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: computeChecksum(source),
    classes: [],
    methods: [
      { id: 'method:run', name: 'run', loc: '1-1', sig: 'export function run()', refs: [] },
    ],
    imports: [],
    exports: ['run'],
  };

  const pipeline = new StructurePipeline(
    parserRegistryForExample(),
    {
      getHeaderPath: () => '',
      read: async () => existingHeader,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
    },
    stateStoreForExample(source),
    {
      initialize: async () => {},
      upsert: async (records) => {
        upserts += records.length;
      },
      remove: async () => {},
      removeByFile: async () => {},
      search: async () => [],
      clear: async () => {},
      count: async () => 0,
    },
    {
      name: 'fake',
      dimensions: 1,
      isAvailable: async () => true,
      embed: async () => {
        embeddings++;
        return [1];
      },
      embedBatch: async () => [],
    },
    null,
    configManagerForExample(projectRoot),
    logger,
  );

  await pipeline.processProject();

  assert.equal(embeddings, 1);
  assert.equal(upserts, 1);
});

function parserRegistryForExample() {
  return {
    register() {},
    getParser(filePath) {
      if (!filePath.endsWith('.ts')) return null;
      return {
        language: 'typescript',
        extensions: ['.ts'],
        parse: async () => ({
          file: 'src/example.ts',
          lang: 'typescript',
          classes: [],
          methods: [
            { name: 'run', loc: '1-1', sig: 'export function run()', refs: [] },
          ],
          imports: [],
          exports: ['run'],
        }),
      };
    },
    getSupportedLanguages() { return ['typescript']; },
    getSupportedExtensions() { return ['.ts']; },
  };
}

function stateStoreForExample(source) {
  return {
    initialize: async () => {},
    getChecksum: () => computeChecksum(source),
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
  };
}

function configManagerForExample(projectRoot) {
  const projectConfig = {
    version: 1,
    languages: ['typescript'],
    include: ['src/**/*'],
    exclude: [],
    aiInsight: false,
    aiInsightConcurrency: 1,
    watch: { debounceMs: 100 },
    search: { defaultLimit: 3, maxLimit: 20 },
    dependencyDepth: 1,
  };
  const userConfig = {
    llm: { provider: 'none', model: 'disabled' },
    embedding: { provider: 'fake', model: 'fake' },
  };

  return {
    getProjectRoot: () => projectRoot,
    isInitialized: () => true,
    loadProjectConfig: async () => projectConfig,
    loadUserConfig: async () => userConfig,
    saveProjectConfig: async () => {},
    saveUserConfig: async () => {},
    getDefaultProjectConfig: () => projectConfig,
    getDefaultUserConfig: () => userConfig,
  };
}
