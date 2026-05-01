import { FileWatcher } from '../watcher/FileWatcher';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { IStateStore } from '../interfaces/IStateStore';
import { IStructurePipeline, ISyncService } from '../interfaces/IPipeline';
import { IVectorStore } from '../interfaces/IVectorStore';
import { ScanProgress, SyncResult } from '../interfaces/types';
import { normalizeProjectPath } from '../../utils/projectPath';
import { EmbeddingCacheStats } from '../embedding/CachedEmbeddingProvider';
import { ProviderGuardStats } from '../providers/ProviderGuard';

export interface IndexRuntimeConfigSummary {
  aiInsight: boolean;
  llmProvider: string;
  llmModel: string;
  embeddingProvider: string;
  embeddingModel: string;
}

export class IndexService {
  constructor(
    private configManager: IConfigManager,
    private stateStore: IStateStore,
    private structurePipeline: IStructurePipeline,
    private syncService: ISyncService,
    private vectorStore: IVectorStore,
    private embeddingProvider: IEmbeddingProvider | null,
  ) {}

  isWatchRunning(): boolean {
    return FileWatcher.isWatchRunning(this.configManager.getProjectRoot());
  }

  getProjectRoot(): string {
    return this.configManager.getProjectRoot();
  }

  async getRuntimeConfigSummary(): Promise<IndexRuntimeConfigSummary> {
    const projectConfig = await this.configManager.loadProjectConfig();
    const userConfig = await this.configManager.loadUserConfig();
    return {
      aiInsight: projectConfig.aiInsight,
      llmProvider: userConfig.llm.provider,
      llmModel: userConfig.llm.model,
      embeddingProvider: userConfig.embedding.provider,
      embeddingModel: userConfig.embedding.model,
    };
  }

  async rebuildVectors(): Promise<void> {
    await this.vectorStore.clear();
    await this.vectorStore.initialize(this.embeddingProvider?.dimensions ?? 768);
  }

  getEmbeddingCacheStats(): EmbeddingCacheStats | null {
    const provider = this.embeddingProvider as (IEmbeddingProvider & { getCacheStats?: () => EmbeddingCacheStats }) | null;
    return provider?.getCacheStats?.() ?? null;
  }

  getEmbeddingProviderGuardStats(): ProviderGuardStats | null {
    const provider = this.embeddingProvider as (IEmbeddingProvider & { getProviderGuardStats?: () => ProviderGuardStats | null }) | null;
    return provider?.getProviderGuardStats?.() ?? null;
  }

  scanFiles(files: string[]): Promise<SyncResult[]> {
    const projectRoot = this.configManager.getProjectRoot();
    return this.syncService.syncFiles(files.map(file => normalizeProjectPath(file, projectRoot)));
  }

  async scanProject(onProgress?: (progress: ScanProgress) => void): Promise<{ totalFiles: number; totalMethods: number }> {
    await this.structurePipeline.processProject(onProgress);
    const stats = this.stateStore.getStats();
    return {
      totalFiles: stats.totalFiles,
      totalMethods: stats.totalMethods,
    };
  }
}
