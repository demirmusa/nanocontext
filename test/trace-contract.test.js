const test = require('node:test');
const assert = require('node:assert/strict');

const { DependencyService } = require('../dist/core/services/DependencyService');
const { applyHeaderIdentity } = require('../dist/core/identity/recordIds');

function createHeaders() {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'entry', loc: '1-2', sig: 'entry()', refs: ['stepA'] },
      { name: 'stepA', loc: '4-5', sig: 'stepA()', refs: ['finish'] },
      { name: 'finish', loc: '7-8', sig: 'finish()', refs: [] },
    ],
    imports: [],
    exports: [],
  });
  return { [header.file]: header };
}

function createService(headers) {
  return new DependencyService(
    { getProjectRoot: () => 'D:/repo' },
    {
      read: async (file) => headers[file] ?? null,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      listTrackedFiles: () => Object.keys(headers),
      searchExact: (query) => {
        const header = headers['src/example.ts'];
        return header.methods
          .filter(method => method.name.includes(query))
          .map(method => ({ type: 'method', file: header.file, method: method.name, loc: method.loc, id: method.id, sig: method.sig }));
      },
      searchRegex: () => [],
    },
    {
      resolveSymbolTarget: async (query) => ({ query, candidates: [] }),
    },
  );
}

test('dependency service returns callers and trace steps for a symbol', async () => {
  const service = createService(createHeaders());

  const refs = await service.getRefsForSymbol('entry', 2);
  const callers = await service.getCallers('stepA');
  const callees = await service.getCallees('entry');
  const trace = await service.traceSymbol('entry', 3);

  assert.deepEqual(refs, ['finish', 'stepA']);
  assert.equal(callers.results[0].symbol, 'entry');
  assert.equal(callers.results[0].kind, 'caller');
  assert.equal(callees.results[0].symbol, 'stepA');
  assert.equal(callees.results[0].kind, 'callee');
  assert.equal(trace.results.length, 3);
  assert.equal(trace.results[0].symbol, 'entry');
  assert.equal(trace.results[1].symbol, 'stepA');
  assert.match(trace.suggestedNext, /nc get stepA/);
});

test('dependency service returns ranked candidates and explicit missing-index guidance', async () => {
  const service = createService(createHeaders());

  const callers = await service.getCallers('missingSymbol');

  assert.deepEqual(callers.results, []);
  assert.match(callers.warning, /No indexed symbol match found/);
  assert.equal(callers.suggestedNext, 'nc search "missingSymbol"');
});

test('dependency service prefers imported symbols for callees', async () => {
  const headers = {
    'src/main.ts': applyHeaderIdentity({
      file: 'src/main.ts',
      lang: 'typescript',
      checksum: 'checksum-main',
      classes: [],
      methods: [{ name: 'entry', loc: '1-3', sig: 'entry()', refs: ['run'] }],
      imports: ['import { run } from "./worker"'],
      exports: [],
    }),
    'src/worker.ts': applyHeaderIdentity({
      file: 'src/worker.ts',
      lang: 'typescript',
      checksum: 'checksum-worker',
      classes: [],
      methods: [{ name: 'run', loc: '1-2', sig: 'run()', refs: [] }],
      imports: [],
      exports: ['run'],
    }),
    'src/other.ts': applyHeaderIdentity({
      file: 'src/other.ts',
      lang: 'typescript',
      checksum: 'checksum-other',
      classes: [],
      methods: [{ name: 'run', loc: '1-2', sig: 'run()', refs: [] }],
      imports: [],
      exports: ['run'],
    }),
  };

  const service = new DependencyService(
    { getProjectRoot: () => 'D:/repo' },
    {
      read: async (file) => headers[file] ?? null,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      listTrackedFiles: () => Object.keys(headers),
      searchExact: (query) => Object.values(headers).flatMap(header => header.methods
        .filter(method => method.name.includes(query))
        .map(method => ({ type: 'method', file: header.file, method: method.name, loc: method.loc, id: method.id, sig: method.sig }))),
      searchRegex: () => [],
    },
    {
      resolveSymbolTarget: async (query) => query === 'entry'
        ? { query, matched: { file: 'src/main.ts', symbol: 'entry', display: 'entry', loc: '1-3', sig: 'entry()', type: 'method' }, candidates: [] }
        : { query, candidates: [] },
    },
  );

  const callees = await service.getCallees('entry');
  assert.equal(callees.results[0].path, 'src/worker.ts');
  assert.equal(callees.results[0].confidence, 'high');
  assert.match(callees.results[0].reason, /imported ref/);
});
