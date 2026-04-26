import { Container } from '../../core/Container';
import { UserConfig } from '../../core/interfaces/types';
import { colors } from '../utils/colors';

const DISABLED_EMBEDDING = {
  provider: 'none',
  model: 'disabled',
};

export async function stopCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    const config = await container.configManager.loadUserConfig();
    const projectConfig = await container.configManager.loadProjectConfig();
    if (config.embedding.provider === 'none') {
      if (projectConfig.search.smartSearchEnabled) {
        await container.configManager.saveProjectConfig({
          ...projectConfig,
          search: {
            ...projectConfig.search,
            pausedSmartSearchEnabled: true,
            smartSearchEnabled: false,
          },
        });
        console.log(colors.green('Smart Search stopped.'));
        return;
      }
      console.log(colors.dim('Embedding and Smart Search are already stopped.'));
      return;
    }

    const nextConfig: UserConfig = {
      ...config,
      pausedEmbedding: config.embedding,
      embedding: DISABLED_EMBEDDING,
    };
    await container.configManager.saveUserConfig(nextConfig);
    await container.configManager.saveProjectConfig({
      ...projectConfig,
      search: {
        ...projectConfig.search,
        pausedSmartSearchEnabled: projectConfig.search.smartSearchEnabled === true,
        smartSearchEnabled: false,
      },
    });

    console.log(colors.green(`Embedding stopped. Saved ${config.embedding.provider}:${config.embedding.model} for resume.`));
    if (projectConfig.search.smartSearchEnabled) {
      console.log(colors.dim('Smart Search stopped for resume.'));
    }
  } catch (err) {
    console.error(colors.red(`Stop failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

export async function resumeCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    const config = await container.configManager.loadUserConfig();
    const projectConfig = await container.configManager.loadProjectConfig();
    if (config.embedding.provider !== 'none') {
      if (projectConfig.search.pausedSmartSearchEnabled && !projectConfig.search.smartSearchEnabled) {
        const { pausedSmartSearchEnabled: _pausedSmartSearchEnabled, ...search } = projectConfig.search;
        await container.configManager.saveProjectConfig({
          ...projectConfig,
          search: {
            ...search,
            smartSearchEnabled: true,
          },
        });
        console.log(colors.green('Smart Search resumed.'));
        return;
      }
      console.log(colors.dim(`Embedding is already active (${config.embedding.provider}:${config.embedding.model}).`));
      return;
    }
    if (!config.pausedEmbedding || config.pausedEmbedding.provider === 'none') {
      console.log(colors.yellow('No paused embedding config found. Run `nc init` or edit `.nanocontext/config.json` to configure embeddings.'));
      return;
    }

    const { pausedEmbedding: _pausedEmbedding, ...rest } = config;
    await container.configManager.saveUserConfig({
      ...rest,
      embedding: config.pausedEmbedding,
    });
    const { pausedSmartSearchEnabled: _pausedSmartSearchEnabled, ...search } = projectConfig.search;
    await container.configManager.saveProjectConfig({
      ...projectConfig,
      search: {
        ...search,
        smartSearchEnabled: projectConfig.search.pausedSmartSearchEnabled === true,
      },
    });

    console.log(colors.green(`Embedding resumed (${config.pausedEmbedding.provider}:${config.pausedEmbedding.model}).`));
    if (projectConfig.search.pausedSmartSearchEnabled) {
      console.log(colors.dim('Smart Search resumed.'));
    }
    console.log(colors.dim('Run `nc scan --rebuild-vectors` if vectors were built with a different embedding model.'));
  } catch (err) {
    console.error(colors.red(`Resume failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
