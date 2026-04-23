const test = require('node:test');
const assert = require('node:assert/strict');

const { DependencyService } = require('../dist/core/services/DependencyService');
const { applyHeaderIdentity } = require('../dist/core/identity/recordIds');

function createDependencyService(header) {
  return new DependencyService(
    { getProjectRoot: () => 'D:/repo' },
    {
      read: async () => header,
      write: async () => {},
      remove: async () => {},
      exists: () => true,
      getHeaderPath: () => '',
    },
    {
      listTrackedFiles: () => [header.file],
      searchExact: () => [{ type: 'method', file: header.file, method: header.methods[0].name, loc: header.methods[0].loc, id: header.methods[0].id }],
      searchRegex: () => [],
    },
    {
      resolveSymbolTarget: async (query) => ({ query, candidates: [] }),
    },
  );
}

test('dependency depth expands nested refs up to the requested limit', async () => {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'entry', loc: '1-2', sig: 'entry()', refs: ['this.stepA'] },
      { name: 'stepA', class: 'Flow', loc: '4-5', sig: 'stepA()', refs: ['Flow.stepB'] },
      { name: 'stepB', loc: '7-8', sig: 'stepB()', refs: ['finish'] },
    ],
    imports: [],
    exports: [],
  });

  const service = createDependencyService(header);

  assert.deepEqual(await service.getRefs(header.file, 'entry', 1), ['this.stepA']);
  assert.deepEqual(await service.getRefs(header.file, 'entry', 2), ['Flow.stepB', 'this.stepA']);
  assert.deepEqual(await service.getRefs(header.file, header.methods[0].id, 3), ['Flow.stepB', 'finish', 'this.stepA']);
});

test('dependency selector supports qualified method names for overloaded names', async () => {
  const header = applyHeaderIdentity({
    file: 'src/example.ts',
    lang: 'typescript',
    checksum: 'checksum',
    classes: [],
    methods: [
      { name: 'run', class: 'Alpha', loc: '1-2', sig: 'run()', refs: ['alphaOnly'] },
      { name: 'run', class: 'Beta', loc: '4-5', sig: 'run()', refs: ['betaOnly'] },
    ],
    imports: [],
    exports: [],
  });

  const service = createDependencyService(header);

  assert.deepEqual(await service.getRefs(header.file, 'Alpha.run', 1), ['alphaOnly']);
  assert.deepEqual(await service.getRefs(header.file, 'Beta.run', 1), ['betaOnly']);
});
