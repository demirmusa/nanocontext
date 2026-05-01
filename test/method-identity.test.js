const test = require('node:test');
const assert = require('node:assert/strict');

const { applyHeaderIdentity } = require('../dist/core/identity/recordIds');
const { SearchEngine } = require('../dist/core/search/SearchEngine');

const logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

test('method identities stay unique for overloads and same-name methods', () => {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [
      { name: 'Alpha', loc: '1-10' },
      { name: 'Beta', loc: '12-20' },
    ],
    methods: [
      { name: 'run', class: 'Alpha', loc: '2-3', sig: 'run(id: string)', refs: [] },
      { name: 'run', class: 'Alpha', loc: '4-5', sig: 'run(id: number)', refs: [] },
      { name: 'run', class: 'Beta', loc: '13-14', sig: 'run(id: string)', refs: [] },
    ],
    imports: [],
    exports: [],
  });

  assert.equal(new Set(header.methods.map(method => method.id)).size, 3);
  assert.notEqual(header.methods[0].id, header.methods[1].id);
  assert.notEqual(header.methods[0].id, header.methods[2].id);
});

test('method identities disambiguate repeated helper declarations with same signature', () => {
  const header = applyHeaderIdentity({
    file: 'src/example.js',
    lang: 'javascript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'fmtAmt', loc: '10-10', sig: 'function fmtAmt(n)', refs: [] },
      { name: 'fmtAmt', loc: '20-20', sig: 'function fmtAmt(n)', refs: [] },
      { name: 'currSym', loc: '11-11', sig: 'function currSym(code)', refs: [] },
      { name: 'currSym', loc: '21-21', sig: 'function currSym(code)', refs: [] },
    ],
    imports: [],
    exports: [],
  });

  assert.equal(new Set(header.methods.map(method => method.id)).size, 4);
  assert.notEqual(header.methods[0].id, header.methods[1].id);
  assert.notEqual(header.methods[2].id, header.methods[3].id);
});

test('deep search enriches the exact method id instead of the first matching name', async () => {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'run', class: 'Alpha', loc: '2-3', sig: 'run(id: string)', refs: ['validate'], insight: 'alpha run' },
      { name: 'run', class: 'Beta', loc: '8-10', sig: 'run(id: number)', refs: ['persist'], insight: 'beta run' },
    ],
    imports: [],
    exports: [],
  });

  const target = header.methods[1];
  const searchEngine = new SearchEngine(
    {
      initialize: async () => {},
      upsert: async () => {},
      remove: async () => {},
      removeByFile: async () => {},
      search: async () => [{ type: 'method', id: target.id, file: header.file, method: target.name }],
      clear: async () => {},
      count: async () => 0,
    },
    {
      name: 'fake',
      dimensions: 1,
      embed: async () => [0],
    },
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

  const [result] = await searchEngine.searchDeep('run');
  assert.equal(result.class, 'Beta');
  assert.equal(result.sig, 'run(id: number)');
  assert.deepEqual(result.refs, ['persist']);
  assert.equal(result.insight, 'beta run');
});
