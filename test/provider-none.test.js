const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ConfigManager } = require('../dist/core/config/ConfigManager');
const { Container } = require('../dist/core/Container');
const { CachedEmbeddingProvider } = require('../dist/core/embedding/CachedEmbeddingProvider');
const { createTempProject } = require('./helpers/project');

test('missing user config defaults to disabled providers', async (t) => {
  const projectRoot = createTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const configManager = new ConfigManager(projectRoot);
  const userConfig = await configManager.loadUserConfig();

  assert.equal(userConfig.llm.provider, 'none');
  assert.equal(userConfig.embedding.provider, 'none');
});

test('container does not create provider instances when config is disabled', async (t) => {
  const projectRoot = createTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const configManager = new ConfigManager(projectRoot);
  await configManager.saveUserConfig({
    llm: { provider: 'none', model: 'disabled' },
    embedding: { provider: 'none', model: 'disabled' },
  });

  const container = new Container(projectRoot);
  try {
    await container.initialize();

    assert.equal(container.llmProvider, null);
    assert.equal(container.embeddingProvider, null);
    assert.ok(fs.existsSync(path.join(projectRoot, '.nanocontext', 'config.json')));
  } finally {
    await container.dispose();
  }
});

test('cached embedding provider reuses vectors by provider model dimensions and text', async (t) => {
  const projectRoot = createTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  let calls = 0;
  const inner = {
    name: 'fake',
    dimensions: 2,
    isAvailable: async () => true,
    embed: async () => {
      calls++;
      return [calls, calls + 1];
    },
    embedBatch: async (texts) => Promise.all(texts.map(() => inner.embed(''))),
  };

  const cached = new CachedEmbeddingProvider(inner, projectRoot, 'model-a');
  assert.deepEqual(await cached.embed('same text'), [1, 2]);
  assert.deepEqual(await cached.embed('same text'), [1, 2]);
  assert.equal(calls, 1);
  assert.deepEqual(cached.getCacheStats(), { hits: 1, misses: 1, writes: 1, errors: 0 });

  const changedModel = new CachedEmbeddingProvider(inner, projectRoot, 'model-b');
  assert.deepEqual(await changedModel.embed('same text'), [2, 3]);
  assert.equal(calls, 2);
});
