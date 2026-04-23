const test = require('node:test');
const assert = require('node:assert/strict');

const { MemoryService } = require('../dist/core/services/MemoryService');

function createConfigManager() {
  return { getProjectRoot: () => 'D:/repo' };
}

test('memory service normalizes file-scoped remember and list calls', async () => {
  let addArgs;
  let listArgs;
  const service = new MemoryService(
    {
      add: async (...args) => {
        addArgs = args;
        return { id: 'mem_1', text: args[0], createdAt: '2026-01-01T00:00:00.000Z', file: args[2], scope: args[3] };
      },
      list: async (...args) => {
        listArgs = args;
        return [{ id: 'mem_1', text: 'note', createdAt: '2026-01-01T00:00:00.000Z', file: args[1], scope: 'file' }];
      },
      listByFile: async (file) => [{ id: 'mem_1', text: 'note', createdAt: '2026-01-01T00:00:00.000Z', file, scope: 'file' }],
      remove: async () => false,
      removeBefore: async () => 0,
      findSimilar: async () => [],
      close: () => {},
    },
    createConfigManager(),
    { resolveSymbolTarget: async (query) => ({ query, candidates: [] }) },
  );

  const saved = await service.remember('Auth note', undefined, 'src\\auth\\AuthService.cs');
  const listed = await service.list('Auth', 'src\\auth\\AuthService.cs');

  assert.deepEqual(addArgs, ['Auth note', undefined, 'src/auth/AuthService.cs', 'file']);
  assert.deepEqual(listArgs, ['Auth', 'src/auth/AuthService.cs', undefined]);
  assert.equal(saved.file, 'src/auth/AuthService.cs');
  assert.equal(listed[0].scope, 'file');
});
