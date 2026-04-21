import * as fs from 'fs';
import * as path from 'path';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IFileWatcher } from '../interfaces/IFileWatcher';
import { ISyncService } from '../interfaces/IPipeline';
import { SyncResult, SyncStep } from '../interfaces/types';
import { FileWatcher } from '../watcher/FileWatcher';

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
  status: 'stopped' | 'not_running' | 'stale_lock_removed';
  pid?: number;
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

  stop(): Promise<void> {
    this.listeners = [];
    return this.fileWatcher.stop();
  }

  stopRunningProcess(): WatchStopResult {
    const lockPath = path.join(this.configManager.getProjectRoot(), '.nanocontext', 'watch.lock');
    if (!fs.existsSync(lockPath)) {
      return { status: 'not_running' };
    }

    try {
      const pid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      return { status: 'stopped', pid };
    } catch {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return { status: 'stale_lock_removed' };
    }
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
