import { Container } from '../../core/Container';
import { WatchUpdate } from '../../core/services/WatchService';
import { colors } from '../utils/colors';

export async function watchCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  if (container.watchService.isRunning()) {
    console.log(colors.yellow('Watch is already running in another process.'));
    return;
  }

  try {
    await container.initialize();
    await container.watchService.start(renderWatchUpdate);
    console.log(colors.green('Watching for changes... (Ctrl+C to stop)\n'));

    // Keep process alive
    const shutdown = async () => {
      await container.dispose();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error(colors.red(`Watch failed: ${err}`));
    await container.dispose();
    process.exit(1);
  }
}

export function watchStopCommand(): void {
  const container = new Container();
  const result = container.watchService.stopRunningProcess();

  if (result.status === 'not_running') {
    console.log(colors.yellow('No watch process is running.'));
  } else if (result.status === 'stopped') {
    console.log(colors.green(`Stopped watch process (pid ${result.pid}).`));
  } else {
    console.log(colors.yellow('Watch process was not running (stale lock removed).'));
  }
}

function renderWatchUpdate(update: WatchUpdate): void {
  const time = colors.dim(new Date(update.at).toLocaleTimeString());
  const file = colors.cyan(update.file);
  const stepLabels: Record<string, string> = {
    checksum: 'checksum',
    parsing: 'tree-sitter',
    insight: 'ai insight',
    vectors: 'vectors',
  };

  if (update.kind === 'step') {
    writeWatchStatus(`${time} ${file} → ${colors.yellow(stepLabels[update.step] || update.step)}`);
    return;
  }

  if (update.kind === 'error') {
    clearWatchStatus();
    console.error(colors.red(`Sync error for ${update.file}: ${update.error}`));
    return;
  }

  if (update.result.action === 'unchanged') {
    writeWatchStatus(`${time} ${file} ${colors.dim('unchanged')}`);
  } else if (update.result.action === 'deleted') {
    writeWatchStatus(`${time} ${file} ${colors.red('deleted')} -${update.result.methodsRemoved}`);
  } else {
    const diff = `+${update.result.methodsAdded} ~${update.result.methodsUpdated} -${update.result.methodsRemoved}`;
    writeWatchStatus(`${time} ${file} ${colors.green('✓')} ${diff}`);
  }
  process.stdout.write('\n');
  watchLineLength = 0;
}

let watchLineLength = 0;

function writeWatchStatus(text: string): void {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = watchLineLength > plain.length ? ' '.repeat(watchLineLength - plain.length) : '';
  process.stdout.write(`\r${text}${pad}`);
  watchLineLength = plain.length;
}

function clearWatchStatus(): void {
  if (watchLineLength === 0) return;
  process.stdout.write(`\r${' '.repeat(watchLineLength)}\r`);
  watchLineLength = 0;
}
