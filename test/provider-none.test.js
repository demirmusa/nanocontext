const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ConfigManager } = require('../dist/core/config/ConfigManager');
const { Container } = require('../dist/core/Container');
const { CachedEmbeddingProvider } = require('../dist/core/embedding/CachedEmbeddingProvider');
const { GuardedEmbeddingProvider } = require('../dist/core/providers/ProviderGuard');
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

test('guarded embedding provider retries retryable failures and stops on non-retryable failures', async () => {
  let attempts = 0;
  const retryable = new GuardedEmbeddingProvider({
    name: 'fake',
    dimensions: 1,
    isAvailable: async () => true,
    embed: async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('rate limit');
        error.status = 429;
        throw error;
      }
      return [1];
    },
    embedBatch: async () => [],
  }, { maxRetries: 2, baseDelayMs: 1, timeoutMs: 1000, maxConcurrency: 1 });

  assert.deepEqual(await retryable.embed('x'), [1]);
  assert.equal(retryable.getProviderGuardStats().retries, 1);
  assert.equal(retryable.getProviderGuardStats().rateLimits, 1);

  const nonRetryable = new GuardedEmbeddingProvider({
    name: 'fake',
    dimensions: 1,
    isAvailable: async () => true,
    embed: async () => {
      const error = new Error('bad request');
      error.status = 400;
      throw error;
    },
    embedBatch: async () => [],
  }, { maxRetries: 2, baseDelayMs: 1, timeoutMs: 1000, maxConcurrency: 1 });

  await assert.rejects(() => nonRetryable.embed('x'), /bad request/);
  assert.equal(nonRetryable.getProviderGuardStats().retries, 0);
  assert.equal(nonRetryable.getProviderGuardStats().nonRetryableFailures, 1);
});
