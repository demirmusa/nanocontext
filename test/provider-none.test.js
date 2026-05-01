const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ConfigManager } = require('../dist/core/config/ConfigManager');
const { Container } = require('../dist/core/Container');
const { CachedEmbeddingProvider } = require('../dist/core/embedding/CachedEmbeddingProvider');
const { OllamaEmbeddingProvider } = require('../dist/core/embedding/providers/OllamaEmbeddingProvider');
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

test('guarded ollama embedding provider serializes local embedding calls', async () => {
  let active = 0;
  let maxActive = 0;
  const provider = new GuardedEmbeddingProvider({
    name: 'ollama',
    dimensions: 1,
    isAvailable: async () => true,
    embed: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active--;
      return [1];
    },
    embedBatch: async () => [],
  }, { baseDelayMs: 1, timeoutMs: 1000 });

  await Promise.all([
    provider.embed('a'),
    provider.embed('b'),
    provider.embed('c'),
  ]);

  assert.equal(maxActive, 1);
});

test('ollama embedding provider truncates oversized prompts before sending', async (t) => {
  const originalFetch = global.fetch;
  let sentPrompt = '';
  global.fetch = async (_url, options) => {
    sentPrompt = JSON.parse(options.body).prompt;
    return new Response(JSON.stringify({ embedding: [1] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new OllamaEmbeddingProvider({
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'tiny',
  });

  await provider.embed('x'.repeat(7000));

  assert.equal(sentPrompt.length, 2000);
});

test('ollama embedding provider shrinks prompts after context length errors', async (t) => {
  const originalFetch = global.fetch;
  const sentLengths = [];
  global.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).prompt;
    sentLengths.push(prompt.length);
    if (prompt.length > 500) {
      return new Response(JSON.stringify({ error: 'the input length exceeds the context length' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ embedding: [1] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new OllamaEmbeddingProvider({
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'tiny',
  });

  assert.deepEqual(await provider.embed('x'.repeat(7000)), [1]);
  assert.deepEqual(sentLengths, [2000, 1000, 500]);
});

test('ollama embedding provider surfaces context length errors after minimum prompt size', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'the input length exceeds the context length' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new OllamaEmbeddingProvider({
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'tiny',
  });

  await assert.rejects(() => provider.embed('x'.repeat(7000)), /context length/);
  assert.equal(calls, 4);
});

test('guarded provider does not retry deterministic context length failures', async () => {
  let attempts = 0;
  const provider = new GuardedEmbeddingProvider({
    name: 'fake',
    dimensions: 1,
    isAvailable: async () => true,
    embed: async () => {
      attempts++;
      const error = new Error('Ollama embedding error: 500 {"error":"the input length exceeds the context length"}');
      error.status = 500;
      throw error;
    },
    embedBatch: async () => [],
  }, { maxRetries: 3, baseDelayMs: 1, timeoutMs: 1000, maxConcurrency: 1 });

  await assert.rejects(() => provider.embed('x'), /context length/);
  assert.equal(attempts, 1);
  assert.equal(provider.getProviderGuardStats().retries, 0);
  assert.equal(provider.getProviderGuardStats().nonRetryableFailures, 1);
});
