import { confirm } from '@inquirer/prompts';
import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function rememberCommand(text: string, options: { ref?: string; file?: string; symbol?: string }): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const memory = await container.memoryService.remember(text, options.ref, options.file, options.symbol);
    const scopeLabel = memory.scope === 'symbol' && memory.symbol
      ? `symbol:${memory.symbol}`
      : memory.scope === 'file' && memory.file
        ? `file:${memory.file}`
        : 'project';
    console.log(colors.green(`✓ Saved to memory (${memory.id}) ${colors.dim(`[${scopeLabel}]`)}`));

    // Check for similar existing memories and warn
    try {
      const similar = await container.memoryService.findSimilar(text, 0.5);
      const others = similar.filter(m => m.id !== memory.id);
      if (others.length > 0) {
        console.log(colors.yellow(`\nNote: ${others.length} similar memor${others.length === 1 ? 'y' : 'ies'} found:`));
        for (const m of others.slice(0, 3)) {
          console.log(`  ${colors.dim(m.id)}  ${m.text}${formatMemoryScope(m)}`);
        }
      }
    } catch {
      // Non-critical, ignore similarity check failures
    }
  } catch (err) {
    console.error(colors.red(`Remember failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

export async function memoriesCommand(options: { search?: string; file?: string; symbol?: string }): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const memories = await container.memoryService.list(options.search, options.file, options.symbol);

    if (memories.length === 0) {
      console.log(colors.dim('No memories found.'));
      return;
    }

    for (const m of memories) {
      console.log(`  ${colors.cyan(m.id)}  ${colors.dim(formatMemoryTimestamp(m.createdAt))}  ${m.text}${formatMemoryScope(m)}`);
    }
  } catch (err) {
    console.error(colors.red(`Failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

export function formatMemoryScope(memory: { symbol?: string; file?: string }): string {
  if (memory.symbol) {
    return colors.dim(` (${memory.symbol}${memory.file ? ` @ ${memory.file}` : ''})`);
  }
  if (memory.file) {
    return colors.dim(` (${memory.file})`);
  }
  return '';
}

export function formatMemoryTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }

  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export async function forgetCommand(id: string | undefined, options: { before?: string }): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    if (options.before) {
      const confirmed = await confirm({
        message: `Delete all memories before ${options.before}?`,
        default: false,
      });
      if (!confirmed) {
        console.log(colors.dim('Cancelled.'));
        return;
      }
      const count = await container.memoryService.forgetBefore(options.before);
      console.log(colors.green(`✓ ${count} memories deleted.`));
    } else {
      if (!id) {
        console.log(colors.red('Provide a memory ID or use `--before`.'));
        process.exit(1);
      }
      const deleted = await container.memoryService.forget(id);
      if (deleted) {
        console.log(colors.green('✓ Memory deleted.'));
      } else {
        console.log(colors.yellow('Memory not found.'));
      }
    }
  } catch (err) {
    console.error(colors.red(`Forget failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
