const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { TypeScriptParser } = require('../dist/core/parser/languages/TypeScriptParser');
const { JavaScriptParser } = require('../dist/core/parser/languages/JavaScriptParser');
const { CSharpParser } = require('../dist/core/parser/languages/CSharpParser');
const { SqliteStateStore } = require('../dist/core/storage/SqliteStateStore');
const { DependencyService } = require('../dist/core/services/DependencyService');
const { createTempProject } = require('./helpers/project');

test('typescript parser captures property readers and writers', async () => {
  const parser = new TypeScriptParser();
  const parsed = await parser.parse(`
class Auth {
  refresh() {
    this.user = props.value;
    return store.auth.token || config.JwtIssuer;
  }
}
`, 'src/auth.ts');

  const refs = parsed.methods[0].stateRefs;
  assert.ok(refs.some(ref => ref.path === 'this.user' && ref.kind === 'write'));
  assert.ok(refs.some(ref => ref.path === 'props.value' && ref.kind === 'read'));
  assert.ok(refs.some(ref => ref.path === 'store.auth.token' && ref.kind === 'read'));
  assert.ok(refs.some(ref => ref.path === 'config.JwtIssuer' && ref.kind === 'read'));
});

test('javascript parser captures state paths in functions', async () => {
  const parser = new JavaScriptParser();
  const parsed = await parser.parse(`
function update() {
  state.user = store.auth.user;
  return props.value;
}
`, 'src/update.js');

  const refs = parsed.methods[0].stateRefs;
  assert.ok(refs.some(ref => ref.path === 'state.user' && ref.kind === 'write'));
  assert.ok(refs.some(ref => ref.path === 'store.auth.user' && ref.kind === 'read'));
  assert.ok(refs.some(ref => ref.path === 'props.value' && ref.kind === 'read'));
});

test('csharp parser captures config property readers and writers', async () => {
  const parser = new CSharpParser();
  const parsed = await parser.parse(`
public class AuthService {
  public string Build() {
    this.User = state.User;
    return config.JwtIssuer;
  }
}
`, 'src/AuthService.cs');

  const refs = parsed.methods[0].stateRefs;
  assert.ok(refs.some(ref => ref.path === 'this.User' && ref.kind === 'write'));
  assert.ok(refs.some(ref => ref.path === 'state.User' && ref.kind === 'read'));
  assert.ok(refs.some(ref => ref.path === 'config.JwtIssuer' && ref.kind === 'read'));
});

test('state store and dependency service return readers and writers separately', async (t) => {
  const projectRoot = createTempProject();

  const stateStore = new SqliteStateStore(projectRoot);
  await stateStore.initialize();
  t.after(() => {
    stateStore.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  stateStore.indexStateReference({
    file: 'src/auth.ts',
    path: 'store.auth.token',
    range: '3-3',
    kind: 'read',
    symbol: 'Auth#read',
    symbolId: 'method:read',
  });
  stateStore.indexStateReference({
    file: 'src/auth.ts',
    path: 'store.auth.token',
    range: '7-7',
    kind: 'write',
    symbol: 'Auth#write',
    symbolId: 'method:write',
  });

  const service = new DependencyService(
    { getProjectRoot: () => projectRoot },
    { read: async () => null, write: async () => {}, remove: async () => {}, exists: () => true, getHeaderPath: () => '' },
    stateStore,
    { resolveSymbolTarget: async (query) => ({ query, candidates: [] }) },
  );

  const readers = await service.getStateReaders('store.auth.token');
  const writers = await service.getStateWriters('store.auth.token');
  assert.equal(readers.length, 1);
  assert.equal(readers[0].symbol, 'Auth#read');
  assert.equal(writers.length, 1);
  assert.equal(writers[0].symbol, 'Auth#write');
});
