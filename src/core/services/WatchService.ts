import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IFileWatcher } from '../interfaces/IFileWatcher';
import { ISyncService } from '../interfaces/IPipeline';
import { SyncResult, SyncStep } from '../interfaces/types';
import { FileWatcher, WatchProcessInfo } from '../watcher/FileWatcher';

export interface WatchUpdateStep {
  kind: 'step';
  at: string;
  file: string;
  step: Exclude<SyncStep, 'done'>;
}

export interface WatchUpdateResult {
  kind: 'result';
  at: string;
  file: string;
  result: SyncResult;
}

export interface WatchUpdateError {
  kind: 'error';
  at: string;
  file: string;
  error: string;
}

export type WatchUpdate = WatchUpdateStep | WatchUpdateResult | WatchUpdateError;

export interface WatchStopResult {
  status: 'stopped' | 'not_running';
  pid?: number;
  projectRoot?: string;
}

export interface WatchStopAllResult {
  stopped: WatchProcessInfo[];
}

export interface WatchStartDetachedResult {
  pid: number | undefined;
  projectRoot: string;
  logPath: string;
  errorLogPath: string;
}

export class WatchService {
  private listeners: Array<(update: WatchUpdate) => void> = [];
  private bridgeRegistered = false;

  constructor(
    private configManager: IConfigManager,
    private fileWatcher: IFileWatcher,
    private syncService: ISyncService,
  ) {}

  isRunning(): boolean {
    return FileWatcher.isWatchRunning(this.configManager.getProjectRoot());
  }

  getRunningProjectWatch(): WatchProcessInfo | null {
    return FileWatcher.getRunningProjectWatch(this.configManager.getProjectRoot());
  }

  listRunningWatches(): WatchProcessInfo[] {
    return FileWatcher.listRunningWatches();
  }

  async start(listener: (update: WatchUpdate) => void): Promise<void> {
    this.listeners = [listener];

    if (!this.bridgeRegistered) {
      this.fileWatcher.onFileChanged((filePath) => {
        void this.handleFileChange(filePath);
      });
      this.bridgeRegistered = true;
    }

    await this.fileWatcher.start();
  }

  startDetached(cliPath: string): WatchStartDetachedResult {
    const projectRoot = this.configManager.getProjectRoot();
    const logDir = path.join(projectRoot, '.nanocontext', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const logPath = path.join(logDir, 'watch.out.log');
    const errorLogPath = path.join(logDir, 'watch.err.log');
    const out = fs.openSync(logPath, 'w');
    const err = fs.openSync(errorLogPath, 'w');

    const child = spawn(process.execPath, [cliPath, 'watch'], {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, NC_WATCH_LOG_PATH: logPath, NC_WATCH_DETACHED_CHILD: '1' },
      windowsHide: true,
    });
    child.unref();
    fs.closeSync(out);
    fs.closeSync(err);

    if (child.pid !== undefined) {
      FileWatcher.registerWatchInfo({
        pid: child.pid,
        projectRoot,
        startedAt: new Date().toISOString(),
        logPath,
      });
    }

    return {
      pid: child.pid,
      projectRoot,
      logPath,
      errorLogPath,
    };
  }

  stop(): Promise<void> {
    this.listeners = [];
    return this.fileWatcher.stop();
  }

  stopRunningProcess(): WatchStopResult {
    const info = this.getRunningProjectWatch()
      ?? this.listRunningWatches().find(watch => path.resolve(watch.projectRoot) === path.resolve(this.configManager.getProjectRoot()))
      ?? null;
    if (!info) return { status: 'not_running' };
    FileWatcher.stopProjectWatch(info.projectRoot);
    return { status: 'stopped', pid: info.pid, projectRoot: info.projectRoot };
  }

  stopAllRunningProcesses(): WatchStopAllResult {
    return { stopped: FileWatcher.stopAllWatches() };
  }

  private async handleFileChange(filePath: string): Promise<void> {
    try {
      const result = await this.syncService.syncFile(filePath, (step) => {
        if (step === 'done') return;
        this.broadcast({
          kind: 'step',
          at: new Date().toISOString(),
          file: filePath,
          step,
        });
      });

      this.broadcast({
        kind: 'result',
        at: new Date().toISOString(),
        file: filePath,
        result,
      });
    } catch (err) {
      this.broadcast({
        kind: 'error',
        at: new Date().toISOString(),
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private broadcast(update: WatchUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}
