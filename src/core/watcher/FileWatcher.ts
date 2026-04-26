import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { IFileWatcher } from '../interfaces/IFileWatcher';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IParserRegistry } from '../interfaces/IParser';
import { ILogger } from '../interfaces/ILogger';
import { normalizeProjectPath, ProjectPathError } from '../../utils/projectPath';

export interface WatchProcessInfo {
  pid: number;
  projectRoot: string;
  startedAt: string;
  logPath: string;
}

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
      const info = FileWatcher.createWatchInfo(this.configManager.getProjectRoot());
      FileWatcher.registerWatchInfo(info);
    } catch { /* ignore */ }
  }

  private removeLockFile(): void {
    const info = FileWatcher.readProjectWatchInfo(this.configManager.getProjectRoot());
    try {
      fs.unlinkSync(this.lockFilePath);
    } catch { /* ignore */ }
    if (info) FileWatcher.removeWatchInfo(info.projectRoot);
  }

  static isWatchRunning(projectRoot: string): boolean {
    return FileWatcher.getRunningProjectWatch(projectRoot) !== null;
  }

  static getRunningProjectWatch(projectRoot: string): WatchProcessInfo | null {
    const info = FileWatcher.readProjectWatchInfo(projectRoot);
    if (!info) return null;
    if (FileWatcher.isPidRunning(info.pid)) return info;
    FileWatcher.removeStaleProjectWatch(projectRoot);
    return null;
  }

  static listRunningWatches(): WatchProcessInfo[] {
    const infos = FileWatcher.readRegistry();
    const running = infos.filter(info => FileWatcher.isPidRunning(info.pid));
    if (running.length !== infos.length) {
      FileWatcher.writeRegistry(running);
      for (const info of infos) {
        if (!running.includes(info)) FileWatcher.removeStaleProjectWatch(info.projectRoot);
      }
    }
    return running;
  }

  static stopProjectWatch(projectRoot: string): WatchProcessInfo | null {
    const resolvedRoot = path.resolve(projectRoot);
    const info = FileWatcher.getRunningProjectWatch(resolvedRoot)
      ?? FileWatcher.listRunningWatches().find(watch => path.resolve(watch.projectRoot) === resolvedRoot)
      ?? null;
    if (!info) return null;
    process.kill(info.pid, 'SIGTERM');
    FileWatcher.removeWatchInfo(info.projectRoot);
    try { fs.unlinkSync(FileWatcher.projectLockPath(resolvedRoot)); } catch { /* ignore */ }
    return info;
  }

  static stopAllWatches(): WatchProcessInfo[] {
    const watches = FileWatcher.listRunningWatches();
    const stopped: WatchProcessInfo[] = [];

    for (const watch of watches) {
      try {
        process.kill(watch.pid, 'SIGTERM');
        stopped.push(watch);
      } catch {
        // Treat vanished processes as cleaned up below.
      }
      FileWatcher.removeWatchInfo(watch.projectRoot);
      try { fs.unlinkSync(FileWatcher.projectLockPath(watch.projectRoot)); } catch { /* ignore */ }
    }

    return stopped;
  }

  static registerWatchInfo(info: WatchProcessInfo): void {
    const resolvedInfo = { ...info, projectRoot: path.resolve(info.projectRoot) };
    const lockPath = FileWatcher.projectLockPath(resolvedInfo.projectRoot);
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify(resolvedInfo, null, 2), 'utf-8');
    FileWatcher.upsertWatchInfo(resolvedInfo);
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

  private static createWatchInfo(projectRoot: string): WatchProcessInfo {
    return {
      pid: process.pid,
      projectRoot: path.resolve(projectRoot),
      startedAt: new Date().toISOString(),
      logPath: process.env.NC_WATCH_LOG_PATH || path.join(projectRoot, '.nanocontext', 'logs', 'watch.out.log'),
    };
  }

  private static projectLockPath(projectRoot: string): string {
    return path.join(projectRoot, '.nanocontext', 'watch.lock');
  }

  private static registryPath(): string {
    return path.join(os.homedir(), '.nanocontext', 'watchers.json');
  }

  private static readProjectWatchInfo(projectRoot: string): WatchProcessInfo | null {
    const lockPath = FileWatcher.projectLockPath(projectRoot);
    if (!fs.existsSync(lockPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as WatchProcessInfo;
    } catch {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return null;
    }
  }

  private static isPidRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private static readRegistry(): WatchProcessInfo[] {
    const registryPath = FileWatcher.registryPath();
    if (!fs.existsSync(registryPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as WatchProcessInfo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private static writeRegistry(infos: WatchProcessInfo[]): void {
    const registryPath = FileWatcher.registryPath();
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(infos, null, 2), 'utf-8');
  }

  private static upsertWatchInfo(info: WatchProcessInfo): void {
    const infos = FileWatcher.readRegistry().filter(existing => existing.projectRoot !== info.projectRoot);
    infos.push(info);
    FileWatcher.writeRegistry(infos);
  }

  private static removeWatchInfo(projectRoot: string): void {
    const resolvedRoot = path.resolve(projectRoot);
    FileWatcher.writeRegistry(FileWatcher.readRegistry().filter(info => info.projectRoot !== resolvedRoot));
  }

  private static removeStaleProjectWatch(projectRoot: string): void {
    try { fs.unlinkSync(FileWatcher.projectLockPath(projectRoot)); } catch { /* ignore */ }
    FileWatcher.removeWatchInfo(projectRoot);
  }
}
