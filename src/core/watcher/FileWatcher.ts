import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { IFileWatcher } from '../interfaces/IFileWatcher';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IParserRegistry } from '../interfaces/IParser';
import { ILogger } from '../interfaces/ILogger';
import { normalizeProjectPath, ProjectPathError } from '../../utils/projectPath';

export class FileWatcher implements IFileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private _isWatching = false;
  private callbacks: Array<(filePath: string) => void> = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private configManager: IConfigManager,
    private logger: ILogger,
    private parserRegistry: IParserRegistry,
  ) {}

  get isWatching(): boolean {
    return this._isWatching;
  }

  async start(): Promise<void> {
    if (this._isWatching) return;

    const config = await this.configManager.loadProjectConfig();
    const projectRoot = this.configManager.getProjectRoot();

    // Extract directory roots from include globs (e.g. "src/**/*" → "src")
    const watchDirs = config.include.map(p => {
      const root = p.split(/[*{?]/)[0].replace(/\/+$/, '') || '.';
      return path.join(projectRoot, root).replace(/\\/g, '/');
    });

    // Merge config.exclude with .nanocontextignore
    const ignorePatterns: string[] = [...config.exclude];
    const ignorePath = path.join(projectRoot, '.nanocontextignore');
    if (fs.existsSync(ignorePath)) {
      const lines = fs.readFileSync(ignorePath, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      ignorePatterns.push(...lines);
    }

    // Custom filter: check ignore patterns with minimatch (chokidar globs unreliable on Windows)
    const supportedExts = new Set(this.parserRegistry.getSupportedExtensions());
    const shouldIgnore = (filePath: string) => {
      const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');

      // Check all ignore patterns via minimatch
      for (const pattern of ignorePatterns) {
        if (minimatch(relative, pattern, { dot: true })) return true;
      }

      // Allow directories to be traversed
      try {
        if (fs.statSync(filePath).isDirectory()) return false;
      } catch { /* check by extension */ }

      // Only watch files with supported extensions
      const ext = path.extname(filePath).toLowerCase();
      return !supportedExts.has(ext);
    };

    this.watcher = chokidar.watch(watchDirs, {
      ignored: shouldIgnore,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    const debounceMs = config.watch.debounceMs;

    this.watcher.on('change', (filePath: string) => {
      this.handleFileChange(filePath, debounceMs, projectRoot);
    });

    this.watcher.on('add', (filePath: string) => {
      this.handleFileChange(filePath, debounceMs, projectRoot);
    });

    this.watcher.on('unlink', (filePath: string) => {
      try {
        this.notifyCallbacks(normalizeProjectPath(filePath, projectRoot));
      } catch (err) {
        if (!(err instanceof ProjectPathError)) {
          this.logger.error('Watcher unlink normalization failed:', err);
        }
      }
    });

    this.watcher.on('error', (err: unknown) => {
      this.logger.error('Watcher error:', err);
    });

    // Wait for chokidar to finish initial scan before marking as ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => {
        const watched = this.watcher!.getWatched();
        const dirCount = Object.keys(watched).length;
        const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
        this.logger.info(`Watcher ready: ${dirCount} dirs, ${fileCount} files`);
        resolve();
      });
    });

    this._isWatching = true;
    this.writeLockFile();
    this.logger.info('File watcher started');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this._isWatching = false;
    this.removeLockFile();
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    this.logger.info('File watcher stopped');
  }

  onFileChanged(callback: (filePath: string) => void): void {
    this.callbacks.push(callback);
  }

  private get lockFilePath(): string {
    return path.join(this.configManager.getProjectRoot(), '.nanocontext', 'watch.lock');
  }

  private writeLockFile(): void {
    try {
      fs.writeFileSync(this.lockFilePath, String(process.pid), 'utf-8');
    } catch { /* ignore */ }
  }

  private removeLockFile(): void {
    try {
      fs.unlinkSync(this.lockFilePath);
    } catch { /* ignore */ }
  }

  static isWatchRunning(projectRoot: string): boolean {
    const lockPath = path.join(projectRoot, '.nanocontext', 'watch.lock');
    if (!fs.existsSync(lockPath)) return false;
    try {
      const pid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
      process.kill(pid, 0); // throws if process doesn't exist
      return true;
    } catch {
      // Stale lock file — clean up
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return false;
    }
  }

  private handleFileChange(filePath: string, debounceMs: number, projectRoot: string): void {
    let relative: string;

    try {
      relative = normalizeProjectPath(filePath, projectRoot);
    } catch (err) {
      if (!(err instanceof ProjectPathError)) {
        this.logger.error('Watcher path normalization failed:', err);
      }
      return;
    }

    // Clear existing timer for this file
    const existing = this.debounceTimers.get(relative);
    if (existing) clearTimeout(existing);

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(relative);
      this.notifyCallbacks(relative);
    }, debounceMs);

    this.debounceTimers.set(relative, timer);
  }

  private notifyCallbacks(filePath: string): void {
    for (const cb of this.callbacks) {
      try {
        cb(filePath);
      } catch (err) {
        this.logger.error('Watcher callback error:', err);
      }
    }
  }
}
