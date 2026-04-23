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
  );
}

test('dependency service returns callers and trace steps for a symbol', async () => {
  const service = createService(createHeaders());

  const refs = await service.getRefsForSymbol('entry', 2);
  const callers = await service.getCallers('stepA');
  const trace = await service.traceSymbol('entry', 3);

  assert.deepEqual(refs, ['finish', 'stepA']);
  assert.equal(callers[0].method, 'entry');
  assert.equal(trace.length, 3);
  assert.equal(trace[0].symbol, 'entry');
  assert.equal(trace[1].symbol, 'stepA');
});
