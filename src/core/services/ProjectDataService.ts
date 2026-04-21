import * as fs from 'fs';
import * as path from 'path';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { IStateStore } from '../interfaces/IStateStore';
import { IVectorStore } from '../interfaces/IVectorStore';

export type ProjectDataTarget = 'all' | 'headers' | 'vectors';

export interface ProjectDataClearResult {
  clearedHeaders: boolean;
  clearedVectors: boolean;
  clearedState: boolean;
}

export class ProjectDataService {
  constructor(
    private configManager: IConfigManager,
    private stateStore: IStateStore,
    private vectorStore: IVectorStore,
    private embeddingProvider: IEmbeddingProvider | null,
  ) {}

  clearHeaders(): boolean {
    const headersDir = path.join(this.configManager.getProjectRoot(), '.nanocontext', 'headers');
    if (fs.existsSync(headersDir)) {
      fs.rmSync(headersDir, { recursive: true });
      fs.mkdirSync(headersDir, { recursive: true });
      return true;
    }
    return false;
  }

  async clearVectors(): Promise<void> {
    await this.vectorStore.clear();
    await this.vectorStore.initialize(this.embeddingProvider?.dimensions ?? 768);
  }

  async clearAll(): Promise<void> {
    this.clearHeaders();
    await this.clearVectors();
    this.stateStore.clearAll();
  }

  async clear(target: ProjectDataTarget): Promise<ProjectDataClearResult> {
    if (target === 'headers') {
      return {
        clearedHeaders: this.clearHeaders(),
        clearedVectors: false,
        clearedState: false,
      };
    }

    if (target === 'vectors') {
      await this.clearVectors();
      return {
        clearedHeaders: false,
        clearedVectors: true,
        clearedState: false,
      };
    }

    await this.clearAll();
    return {
      clearedHeaders: true,
      clearedVectors: true,
      clearedState: true,
    };
  }
}
