const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ConfigManager } = require('../dist/core/config/ConfigManager');
const { Container } = require('../dist/core/Container');
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
