import * as fs from 'fs';
import * as path from 'path';
import { IInsightPipeline } from '../interfaces/IPipeline';
import { ILLMProvider } from '../interfaces/ILLMProvider';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IConfigManager } from '../interfaces/IConfigManager';
import { ILogger } from '../interfaces/ILogger';
import { HeaderJson, InsightQueueItem } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';

export class InsightPipeline implements IInsightPipeline {
  private _isPaused = false;

  constructor(
    private llmProvider: ILLMProvider | null,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private configManager: IConfigManager,
    private logger: ILogger,
  ) {}

  get isPaused(): boolean {
    return this._isPaused;
  }

  pause(): void {
    this._isPaused = true;
    this.logger.info('Insight pipeline paused');
  }

  resume(): void {
    this._isPaused = false;
    this.logger.info('Insight pipeline resumed');
  }

  async enqueueFile(filePath: string, header: HeaderJson): Promise<void> {
    if (!this.llmProvider) return;

    const config = await this.configManager.loadProjectConfig();
    if (!config.aiInsight) return;

    // Check if provider is available
    const available = await this.llmProvider.isAvailable();
    if (!available) {
      this.logger.warn('LLM provider not available, skipping insight queue');
      return;
    }

    const projectRoot = this.configManager.getProjectRoot();

    // Dedup at file level - skip entire file if already pending
    if (this.stateStore.isInsightPending(filePath)) return;

    // Read file once before the loop
    const fullPath = path.join(projectRoot, filePath);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to read file ${filePath}:`, err);
      return;
    }
    const lines = content.split('\n');

    for (const method of applyHeaderIdentity(header).methods) {
      try {
        const [start, end] = method.loc.split('-').map(Number);
        const methodCode = lines.slice(start - 1, end).join('\n');

        this.stateStore.enqueueInsight({
          file: filePath,
          methodId: method.id,
          methodName: method.name,
          methodCode,
          status: 'pending',
          retries: 0,
          queuedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.error(`Failed to enqueue insight for ${method.name}:`, err);
      }
    }
  }

  async processQueue(onProgress?: (processed: number, total: number) => void): Promise<void> {
    if (!this.llmProvider || this._isPaused) return;

    const total = this.stateStore.getPendingInsightCount();
    if (total === 0) return;

    let processed = 0;
    const batchSize = 5;

    while (!this._isPaused) {
      const batch = this.stateStore.dequeueInsight(batchSize);
      if (batch.length === 0) break;

      for (const item of batch) {
        if (this._isPaused) break;

        try {
          const insight = await this.generateWithRetry(item);

          // Update header.json with insight
          const header = await this.headerStore.read(item.file);
          if (header) {
            const method = header.methods.find(m => m.id === item.methodId)
              ?? header.methods.find(m => m.name === item.methodName);
            if (method) {
              method.insight = insight;
              await this.headerStore.write(item.file, header);
            }
          }

          this.stateStore.completeInsight(item.file, item.methodId);
          processed++;
          onProgress?.(processed, total);
        } catch (err) {
          this.logger.error(`Insight failed for ${item.file}::${item.methodName}:`, err);
          this.stateStore.failInsight(item.file, item.methodId);

          if (item.retries >= 2) {
            this.logger.warn('Too many failures, pausing insight pipeline');
            this.pause();
            break;
          }
        }
      }
    }
  }

  private async generateWithRetry(item: InsightQueueItem): Promise<string> {
    const delays = [2000, 4000, 8000]; // Exponential backoff
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.llmProvider!.generateFileInsights(
          [{ id: item.methodId, name: item.methodName, code: item.methodCode }],
          this.getLanguageFromFile(item.file),
        );
        return result.insights[0]?.insight || '';
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          await this.sleep(delays[attempt]);
        }
      }
    }

    throw lastError;
  }

  private getLanguageFromFile(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.cs': 'csharp',
    };
    return langMap[ext] || 'unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
