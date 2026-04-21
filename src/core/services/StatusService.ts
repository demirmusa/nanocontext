import { IConfigManager } from '../interfaces/IConfigManager';
import { IStateStore } from '../interfaces/IStateStore';
import { IVectorStore } from '../interfaces/IVectorStore';

export interface ProjectStatus {
  totalFiles: number;
  totalMethods: number;
  vectorCount: number;
  pendingInsights: number;
  aiInsight: boolean;
  languages: string[];
  lastScanAt: string | null;
}

export class StatusService {
  constructor(
    private stateStore: IStateStore,
    private vectorStore: IVectorStore,
    private configManager: IConfigManager,
  ) {}

  async getStatus(): Promise<ProjectStatus> {
    const stats = this.stateStore.getStats();
    const vectorCount = await this.vectorStore.count();
    const projectConfig = await this.configManager.loadProjectConfig();

    return {
      totalFiles: stats.totalFiles,
      totalMethods: stats.totalMethods,
      vectorCount,
      pendingInsights: this.stateStore.getPendingInsightCount(),
      aiInsight: projectConfig.aiInsight,
      languages: projectConfig.languages,
      lastScanAt: stats.lastScanAt,
    };
  }
}
