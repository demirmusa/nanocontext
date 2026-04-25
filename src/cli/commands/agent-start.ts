import { Container } from '../../core/Container';
import { colors } from '../utils/colors';
import { formatMemoryScope } from './memory';

export async function agentStartCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    if (container.watchService.isRunning()) {
      const info = container.watchService.getRunningProjectWatch();
      console.log(colors.dim(`Watch already running${info ? ` (pid ${info.pid})` : ''}.`));
    } else {
      const result = container.watchService.startDetached(process.argv[1]);
      console.log(colors.green(`Watch started in background (pid ${result.pid}).`));
      console.log(colors.dim(`  Log: ${result.logPath}`));
    }

    await container.initialize();
    const memories = await container.memoryService.list();
    console.log(colors.bold('\nProject memories'));

    if (memories.length === 0) {
      console.log(colors.dim('No memories found.'));
      return;
    }

    for (const memory of memories) {
      const date = memory.createdAt.split('T')[0];
      console.log(`  ${colors.cyan(memory.id)}  ${colors.dim(date)}  ${memory.text}${formatMemoryScope(memory)}`);
    }
  } catch (err) {
    console.error(colors.red(`Agent start failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
