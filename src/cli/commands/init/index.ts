import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { colors } from '../../utils/colors';
import { CodexAuthStore } from '../../../core/llm/auth/CodexAuthStore';
import { Container } from '../../../core/Container';
import { AgentDefinition } from '../../../core/services/AgentSetupService';
import { EmbeddingConfig, LLMConfig } from '../../../core/interfaces/types';
import { ProjectDetectionSummary } from '../../../core/services/ProjectInitService';

interface InitCommandOptions {
  llmProvider?: string;
  llmModel?: string;
  llmEndpoint?: string;
  llmApiKey?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  embeddingApiKey?: string;
  smartSearch?: boolean;
  include?: string;
  mode?: 'mcp' | 'cli';
  agents?: string;
  yes?: boolean;
  setupOnly?: boolean;
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const container = new Container(cwd);
  const nonInteractive = hasNonInteractiveOptions(options);

  if (options.setupOnly) {
    if (!container.projectInitService.isInitialized(cwd)) {
      console.log(colors.yellow('NanoContext is not initialized in this project. Run `nc init` first.'));
      return;
    }
    await ensureMissingSteps(container, cwd, options);
    return;
  }

  if (container.projectInitService.isInitialized(cwd)) {
    console.log(colors.yellow('NanoContext is already initialized in this project.'));
    const overwrite = nonInteractive
      ? Boolean(options.yes)
      : await confirm({ message: 'Reinitialize from scratch?', default: false });
    if (!overwrite) {
      await ensureMissingSteps(container, cwd, options);
      return;
    }
  }

  console.log(colors.bold('\n🔧 NanoContext Init\n'));

  const detection = container.projectInitService.detectProject(cwd);
  const config = nonInteractive
    ? await resolveProviderConfigFromOptions(detection, options)
    : await promptProviderConfig(detection);
  await container.projectInitService.saveInitConfig(cwd, {
    languages: detection.languages,
    includePatterns: config.includePatterns,
    aiInsight: config.aiInsight,
    smartSearchEnabled: config.smartSearchEnabled,
    aiInsightConcurrency: config.aiInsightConcurrency,
    llm: config.llm,
    embedding: config.embedding,
  });

  for (const change of container.projectInitService.scaffoldProjectFiles(cwd)) {
    console.log(colors.green(`  ✓ Created/Updated ${change}`));
  }

  const interactionMode = nonInteractive
    ? (options.mode ?? 'mcp')
    : await select({
      message: 'How will you use NanoContext?',
      choices: [
        { name: 'Via MCP Server (Recommended for Cursor/Windsurf/Claude)', value: 'mcp' },
        { name: 'Via CLI directly', value: 'cli' },
      ],
    });

  const agents = nonInteractive
    ? resolveAgentsFromOptions(container, options.agents)
    : await selectAgents(container);
  const setupResult = container.agentSetupService.applySetup(cwd, agents, interactionMode as 'mcp' | 'cli');
  logAgentSetupResult(setupResult);

  console.log(colors.green('\n✓ NanoContext initialized.'));
  console.log(colors.dim('Run `nc scan` to index your project, then `nc watch -d` for background auto-indexing.\n'));
}

async function selectAgents(container: Container): Promise<AgentDefinition[]> {
  const agents = container.agentSetupService.getAvailableAgents();
  return checkbox({
    message: 'Setup NanoContext for which agents?',
    choices: agents.map((agent) => ({
      name: `${agent.name} (${agent.mcpConfigPath})`,
      value: agent,
      checked: true,
    })),
  });
}

function logAgentSetupResult(result: { createdMcpConfigs: string[]; removedMcpConfigs: string[]; updatedAgentDocs: string[] }): void {
  for (const file of result.createdMcpConfigs) {
    console.log(colors.green(`  ✓ Created ${file}`));
  }
  for (const file of result.removedMcpConfigs) {
    console.log(colors.green(`  ✓ Removed ${file}`));
  }
  for (const file of result.updatedAgentDocs) {
    console.log(colors.green(`  ✓ Created/Updated ${file}`));
  }
}

async function ensureMissingSteps(container: Container, cwd: string, options: InitCommandOptions = {}): Promise<void> {
  console.log(colors.dim('\nChecking for missing setup steps...\n'));
  let fixed = 0;

  for (const change of container.projectInitService.ensureProjectFiles(cwd)) {
    console.log(colors.green(`  ✓ Created/Updated ${change}`));
    fixed++;
  }

  const nonInteractive = hasNonInteractiveOptions(options);

  const interactionMode = nonInteractive && options.mode
    ? options.mode
    : await select({
      message: 'How will you use NanoContext?',
      choices: [
        { name: 'Via MCP Server (Recommended for Cursor/Windsurf/Claude)', value: 'mcp' },
        { name: 'Via CLI directly', value: 'cli' },
      ],
    });

  const ensureAgents = nonInteractive && options.agents
    ? resolveAgentsFromOptions(container, options.agents)
    : await selectAgents(container);
  const ensureMode = interactionMode as 'mcp' | 'cli';
  const setupResult = container.agentSetupService.applySetup(cwd, ensureAgents, ensureMode);
  logAgentSetupResult(setupResult);
  fixed += setupResult.createdMcpConfigs.length + setupResult.removedMcpConfigs.length + setupResult.updatedAgentDocs.length;

  if (fixed === 0) {
    console.log(colors.dim('  Everything is up to date.'));
  }

  console.log('');
}

interface PromptedProviderConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  aiInsight: boolean;
  smartSearchEnabled: boolean;
  aiInsightConcurrency?: number;
  includePatterns: string[];
}

async function promptProviderConfig(detection: ProjectDetectionSummary): Promise<PromptedProviderConfig> {
  const llmProvider = await select({
    message: 'LLM provider for AI insights:',
    choices: [
      { name: 'Ollama (local)', value: 'ollama' },
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'Codex OAuth (ChatGPT Plus)', value: 'codex-oauth' },
      { name: 'None (structure only)', value: 'none' },
    ],
  });

  let llmConfig: LLMConfig;
  let embeddingConfig: EmbeddingConfig;
  let aiInsight = true;
  let smartSearchEnabled = false;

  if (llmProvider === 'none') {
    aiInsight = false;
    llmConfig = { provider: 'none', model: 'disabled' };
    embeddingConfig = { provider: 'none', model: 'disabled' };
  } else if (llmProvider === 'ollama') {
    const endpoint = await input({
      message: 'Ollama endpoint:',
      default: 'http://localhost:11434',
    });
    const model = await input({ message: 'Ollama model:', default: 'llama3.2' });
    llmConfig = { provider: 'ollama', endpoint, model };
    embeddingConfig = await promptEmbeddingConfig(llmConfig);
  } else if (llmProvider === 'codex-oauth') {
    console.log(colors.yellow('⚠ Code snippets will be sent to OpenAI servers (ChatGPT Plus subscription).'));
    const authStore = new CodexAuthStore();
    const status = authStore.getStatus();
    if (status.authenticated && !status.expired) {
      console.log(colors.green(`  Already authenticated. Account: ${status.accountId}`));
    } else {
      console.log('  Opening browser to authenticate with OpenAI...');
      console.log(colors.dim('  If the browser does not open, copy the URL from the terminal and open it manually.\n'));
      await authStore.login((url) => {
        console.log(colors.cyan(`  ${url}\n`));
        const { exec } = require('child_process') as typeof import('child_process');
        const platform = process.platform;
        const cmd = platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd);
      });
      const newStatus = authStore.getStatus();
      console.log(colors.green(`  Authenticated! Account: ${newStatus.accountId}`));
    }
    const model = await input({ message: 'Model:', default: 'gpt-5.4-mini' });
    llmConfig = { provider: 'codex-oauth', model };
    embeddingConfig = await promptEmbeddingConfig(llmConfig);
  } else {
    console.log(colors.yellow(`⚠ Cloud LLM selected. Code snippets will be sent to ${llmProvider} servers.`));
    const apiKey = await input({ message: `${llmProvider} API key:` });
    const model = await input({
      message: 'Model:',
      default: llmProvider === 'openai' ? 'gpt-5.4-mini' : 'claude-haiku-4-5-20251001',
    });
    llmConfig = { provider: llmProvider, apiKey, model };
    embeddingConfig = await promptEmbeddingConfig(llmConfig);
  }

  if (llmProvider !== 'none') {
    smartSearchEnabled = await confirm({
      message: 'Enable Smart Search? Uses your configured LLM to rerank a larger semantic-search candidate pool before NanoContext returns the final results.',
      default: false,
    });
  }

  console.log(colors.dim(`Detected languages: ${detection.languages.join(', ') || 'none'}`));
  console.log(colors.dim(`Detected source directories: ${detection.sourceDirs.join(', ')}`));

  const includeInput = await input({
    message: 'Include globs (comma-separated):',
    default: detection.defaultIncludePatterns.join(', '),
  });

  return {
    llm: llmConfig,
    embedding: embeddingConfig,
    aiInsight,
    smartSearchEnabled,
    aiInsightConcurrency: undefined,
    includePatterns: includeInput.split(',').map(value => value.trim()).filter(Boolean),
  };
}

async function promptEmbeddingConfig(llmConfig: LLMConfig): Promise<EmbeddingConfig> {
  const embeddingProvider = await select({
    message: 'Embedding provider:',
    choices: [
      { name: 'Ollama (local)', value: 'ollama' },
      { name: 'OpenAI', value: 'openai' },
    ],
  });

  if (embeddingProvider === 'ollama') {
    return {
      provider: 'ollama',
      endpoint: llmConfig.endpoint || 'http://localhost:11434',
      model: 'nomic-embed-text',
    };
  }

  const apiKey = llmConfig.provider === 'openai'
    ? llmConfig.apiKey
    : await input({ message: 'OpenAI API key for embeddings:' });
  return {
    provider: 'openai',
    apiKey: apiKey || '',
    model: 'text-embedding-3-small',
  };
}

async function resolveProviderConfigFromOptions(
  detection: ProjectDetectionSummary,
  options: InitCommandOptions,
): Promise<PromptedProviderConfig> {
  const llmProvider = options.llmProvider ?? 'none';
  let llmConfig: LLMConfig;
  let embeddingConfig: EmbeddingConfig;
  let aiInsight = llmProvider !== 'none';

  if (llmProvider === 'none') {
    llmConfig = { provider: 'none', model: 'disabled' };
    embeddingConfig = { provider: 'none', model: 'disabled' };
  } else if (llmProvider === 'ollama') {
    llmConfig = {
      provider: 'ollama',
      endpoint: options.llmEndpoint || 'http://localhost:11434',
      model: options.llmModel || 'llama3.2',
    };
    embeddingConfig = resolveEmbeddingConfigFromOptions(options, llmConfig);
  } else if (llmProvider === 'openai' || llmProvider === 'anthropic') {
    llmConfig = {
      provider: llmProvider,
      apiKey: options.llmApiKey || '',
      model: options.llmModel || (llmProvider === 'openai' ? 'gpt-5.4-mini' : 'claude-haiku-4-5-20251001'),
    };
    embeddingConfig = resolveEmbeddingConfigFromOptions(options, llmConfig);
  } else if (llmProvider === 'codex-cli') {
    llmConfig = { provider: 'codex-cli', model: options.llmModel || 'gpt-5.4-mini' };
    embeddingConfig = resolveEmbeddingConfigFromOptions(options, llmConfig);
  } else {
    throw new Error(`Unsupported --llm-provider value: ${llmProvider}`);
  }

  return {
    llm: llmConfig,
    embedding: embeddingConfig,
    aiInsight,
    smartSearchEnabled: Boolean(options.smartSearch && llmProvider !== 'none'),
    aiInsightConcurrency: undefined,
    includePatterns: resolveIncludePatterns(detection, options.include),
  };
}

function resolveEmbeddingConfigFromOptions(options: InitCommandOptions, llmConfig: LLMConfig): EmbeddingConfig {
  const embeddingProvider = options.embeddingProvider ?? 'none';
  if (embeddingProvider === 'none') {
    return { provider: 'none', model: 'disabled' };
  }

  if (embeddingProvider === 'ollama') {
    return {
      provider: 'ollama',
      endpoint: options.embeddingEndpoint || llmConfig.endpoint || 'http://localhost:11434',
      model: options.embeddingModel || 'nomic-embed-text',
    };
  }

  if (embeddingProvider === 'openai') {
    return {
      provider: 'openai',
      apiKey: options.embeddingApiKey || llmConfig.apiKey || '',
      model: options.embeddingModel || 'text-embedding-3-small',
    };
  }

  throw new Error(`Unsupported --embedding-provider value: ${embeddingProvider}`);
}

function resolveIncludePatterns(detection: ProjectDetectionSummary, includeOption?: string): string[] {
  const raw = includeOption ?? detection.defaultIncludePatterns.join(', ');
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function resolveAgentsFromOptions(container: Container, agentsOption?: string): AgentDefinition[] {
  const availableAgents = container.agentSetupService.getAvailableAgents();
  if (!agentsOption) {
    return availableAgents;
  }

  const requestedIds = agentsOption.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const selected = availableAgents.filter(agent => requestedIds.includes(agent.id));
  if (selected.length === 0) {
    throw new Error(`No valid agents selected via --agents. Available: ${availableAgents.map(agent => agent.id).join(', ')}`);
  }

  return selected;
}

function hasNonInteractiveOptions(options: InitCommandOptions): boolean {
  return Object.values(options).some(value => value !== undefined);
}
