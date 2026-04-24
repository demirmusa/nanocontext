const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { AgentSetupService } = require('../dist/core/services/AgentSetupService');
const { ProjectInitService } = require('../dist/core/services/ProjectInitService');
const { MCP_TOOL_DEFINITIONS } = require('../dist/mcp/catalog');

const agentSetupService = new AgentSetupService();

test('generated init instructions mirror the MCP tool catalog', () => {
  const instructions = agentSetupService.getNanoContextInstructions();

  for (const tool of MCP_TOOL_DEFINITIONS.filter(tool => tool.name !== 'scan')) {
    assert.match(instructions, new RegExp(`\\\`${tool.name}\\\``));
  }

  for (const removedTool of ['search_deep', 'search_exact', 'search_regex', 'header', 'lines', 'methods', 'sync', 'unwatch', 'watch_list', 'watch_stop', 'scan']) {
    assert.doesNotMatch(instructions, new RegExp(`\\\`${removedTool}\\\``));
  }

  assert.match(instructions, /nc:\/\/headers\/\{file_path\}/);
});

test('generated CLI init instructions mention new lookup and symbol-memory flows', () => {
  const instructions = agentSetupService.getNanoContextInstructions('cli');

  assert.match(instructions, /nc files \[query\]/);
  assert.match(instructions, /nc callees <symbol>/);
  assert.match(instructions, /nc remember "<text>" --symbol/);
  assert.match(instructions, /nc memories --symbol/);
  assert.match(instructions, /nc watch -d/);
  assert.match(instructions, /nc impact <file_or_symbol>/);
  assert.match(instructions, /nc stale/);
  assert.doesNotMatch(instructions, /nc scan/);
});

test('generated MCP configs stay workspace-portable', () => {
  const config = JSON.parse(agentSetupService.renderJsonMcpConfig('mcpServers'));
  assert.deepEqual(config.mcpServers.nanocontext.args, ['mcp-server']);
});

test('project init persists smart search in project config', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-init-'));
  const service = new ProjectInitService();

  await service.saveInitConfig(projectRoot, {
    languages: ['typescript'],
    includePatterns: ['src/**/*'],
    aiInsight: true,
    smartSearchEnabled: true,
    llm: { provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2' },
    embedding: { provider: 'ollama', endpoint: 'http://localhost:11434', model: 'nomic-embed-text' },
  });

  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'nanocontextconfig.json'), 'utf-8'));
  assert.equal(projectConfig.search.smartSearchEnabled, true);
});

test('nc init supports non-interactive setup flags for benchmark automation', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-cli-init-'));
  fs.mkdirSync(path.join(projectRoot, 'Dapper'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Dapper', 'SqlMapper.cs'), 'public class SqlMapper {}', 'utf-8');

  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  execFileSync(process.execPath, [
    cliPath,
    'init',
    '--llm-provider', 'none',
    '--embedding-provider', 'none',
    '--include', 'Dapper/**/*.cs',
    '--mode', 'mcp',
    '--agents', 'codex',
    '--yes',
  ], { cwd: projectRoot, encoding: 'utf-8' });

  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'nanocontextconfig.json'), 'utf-8'));
  const userConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nanocontext', 'config.json'), 'utf-8'));
  const codexConfig = fs.readFileSync(path.join(projectRoot, '.codex', 'config.toml'), 'utf-8');

  assert.deepEqual(projectConfig.include, ['Dapper/**/*.cs']);
  assert.equal(projectConfig.aiInsight, false);
  assert.equal(userConfig.llm.provider, 'none');
  assert.equal(userConfig.embedding.provider, 'none');
  assert.match(codexConfig, /mcp_servers\.nanocontext/);
  assert.match(codexConfig, /mcp-server/);
});

test('nc init in cli mode does not leave codex MCP config behind', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-cli-mode-'));
  fs.mkdirSync(path.join(projectRoot, 'Dapper'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Dapper', 'SqlMapper.cs'), 'public class SqlMapper {}', 'utf-8');

  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');

  execFileSync(process.execPath, [
    cliPath,
    'init',
    '--llm-provider', 'none',
    '--embedding-provider', 'none',
    '--include', 'Dapper/**/*.cs',
    '--mode', 'mcp',
    '--agents', 'codex',
    '--yes',
  ], { cwd: projectRoot, encoding: 'utf-8' });

  assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'config.toml')));

  execFileSync(process.execPath, [
    cliPath,
    'init',
    '--llm-provider', 'none',
    '--embedding-provider', 'none',
    '--include', 'Dapper/**/*.cs',
    '--mode', 'cli',
    '--agents', 'codex',
    '--yes',
  ], { cwd: projectRoot, encoding: 'utf-8' });

  assert.equal(fs.existsSync(path.join(projectRoot, '.codex', 'config.toml')), false);

  const agentsDoc = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');
  assert.match(agentsDoc, /## NanoContext CLI/);
  assert.doesNotMatch(agentsDoc, /## NanoContext MCP/);
});

test('nc init in mcp mode recreates codex MCP config after cli mode', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-mcp-mode-'));
  fs.mkdirSync(path.join(projectRoot, 'Dapper'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Dapper', 'SqlMapper.cs'), 'public class SqlMapper {}', 'utf-8');

  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');

  execFileSync(process.execPath, [
    cliPath,
    'init',
    '--llm-provider', 'none',
    '--embedding-provider', 'none',
    '--include', 'Dapper/**/*.cs',
    '--mode', 'cli',
    '--agents', 'codex',
    '--yes',
  ], { cwd: projectRoot, encoding: 'utf-8' });

  assert.equal(fs.existsSync(path.join(projectRoot, '.codex', 'config.toml')), false);

  execFileSync(process.execPath, [
    cliPath,
    'init',
    '--llm-provider', 'none',
    '--embedding-provider', 'none',
    '--include', 'Dapper/**/*.cs',
    '--mode', 'mcp',
    '--agents', 'codex',
    '--yes',
  ], { cwd: projectRoot, encoding: 'utf-8' });

  const codexConfigPath = path.join(projectRoot, '.codex', 'config.toml');
  assert.ok(fs.existsSync(codexConfigPath));

  const codexConfig = fs.readFileSync(codexConfigPath, 'utf-8');
  assert.match(codexConfig, /mcp_servers\.nanocontext/);
  assert.match(codexConfig, /mcp-server/);

  const agentsDoc = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');
  assert.match(agentsDoc, /## NanoContext MCP/);
  assert.doesNotMatch(agentsDoc, /## NanoContext CLI/);
});
