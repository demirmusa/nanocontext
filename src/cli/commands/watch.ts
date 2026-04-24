import * as fs from 'fs';
import { Container } from '../../core/Container';
import { WatchUpdate } from '../../core/services/WatchService';
import { WatchProcessInfo } from '../../core/watcher/FileWatcher';
import { colors } from '../utils/colors';

export async function watchCommand(options: { detach?: boolean } = {}): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  if (container.watchService.isRunning()) {
    const info = container.watchService.getRunningProjectWatch();
    if (!options.detach && info) {
      attachToWatchLog(info);
      return;
    }
    console.log(colors.yellow(`Watch is already running for this project${info ? ` (pid ${info.pid})` : ''}.`));
    return;
  }

  if (options.detach) {
    startDetachedWatch(container);
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

export function watchListCommand(): void {
  const container = new Container();
  const watches = container.watchService.listRunningWatches();

  if (watches.length === 0) {
    console.log(colors.yellow('No watch processes are running.'));
    return;
  }

  for (const watch of watches) {
    console.log(`${colors.cyan(watch.projectRoot)}  pid ${watch.pid}`);
    console.log(colors.dim(`  started ${watch.startedAt}`));
    console.log(colors.dim(`  log     ${watch.logPath}`));
  }
}

export function watchStopCommand(): void {
  const container = new Container();
  const result = container.watchService.stopRunningProcess();

  if (result.status === 'not_running') {
    console.log(colors.yellow('No watch process is running for this project.'));
  } else {
    console.log(colors.green(`Stopped watch process (pid ${result.pid}).`));
  }
}

function startDetachedWatch(container: Container): void {
  const result = container.watchService.startDetached(process.argv[1]);
  console.log(colors.green(`Watch started in background (pid ${result.pid}).`));
  console.log(colors.dim(`  Project: ${result.projectRoot}`));
  console.log(colors.dim(`  Logs: ${result.logPath}`));
}

function attachToWatchLog(info: WatchProcessInfo): void {
  console.log(colors.green(`Attached to running watch process (pid ${info.pid}).`));
  console.log(colors.dim(`  Project: ${info.projectRoot}`));
  console.log(colors.dim(`  Log: ${info.logPath}\n`));

  let offset = 0;
  const printAvailable = () => {
    if (!fs.existsSync(info.logPath)) return;
    const stat = fs.statSync(info.logPath);
    if (stat.size < offset) offset = 0;
    if (stat.size === offset) return;

    const fd = fs.openSync(info.logPath, 'r');
    const buffer = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);
    offset = stat.size;
    process.stdout.write(buffer.toString('utf-8'));
  };

  printAvailable();
  fs.watchFile(info.logPath, { interval: 500 }, printAvailable);

  const pidCheck = setInterval(() => {
    try {
      process.kill(info.pid, 0);
    } catch {
      fs.unwatchFile(info.logPath, printAvailable);
      clearInterval(pidCheck);
      console.log(colors.yellow('\nWatch process stopped.'));
      process.exit(0);
    }
  }, 1000);

  const shutdown = () => {
    fs.unwatchFile(info.logPath, printAvailable);
    clearInterval(pidCheck);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
