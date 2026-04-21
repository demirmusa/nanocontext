export interface IFileWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFileChanged(callback: (filePath: string) => void): void;
  readonly isWatching: boolean;
}
