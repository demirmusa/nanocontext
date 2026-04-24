import * as fs from 'fs';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IVectorStore } from '../interfaces/IVectorStore';
import { computeChecksum } from '../../utils/checksum';
import { resolveProjectPath } from '../../utils/projectPath';

export interface StaleReport {
  ok: boolean;
  stats: {
    trackedFiles: number;
    changedFiles: number;
    missingFiles: number;
    missingHeaders: number;
    pendingInsights: number;
    vectorCount: number;
    totalMethods: number;
  };
  issues: StaleIssue[];
  suggestedNext: string[];
}

export interface StaleIssue {
  kind: 'changed-file' | 'missing-file' | 'missing-header' | 'pending-insight' | 'vector-mismatch';
  severity: 'high' | 'medium' | 'low';
  file?: string;
  detail: string;
}

export class StaleService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private vectorStore: IVectorStore,
  ) {}

  async inspect(): Promise<StaleReport> {
    const issues: StaleIssue[] = [];
    const trackedFiles = this.stateStore.listTrackedFiles().sort((a, b) => a.localeCompare(b));

    for (const file of trackedFiles) {
      const { absolutePath } = resolveProjectPath(file, this.configManager.getProjectRoot());
      if (!fs.existsSync(absolutePath)) {
        issues.push({
          kind: 'missing-file',
          severity: 'high',
          file,
          detail: 'indexed file no longer exists on disk',
        });
        continue;
      }

      const currentChecksum = computeChecksum(fs.readFileSync(absolutePath, 'utf-8'));
      const indexedChecksum = this.stateStore.getChecksum(file);
      if (indexedChecksum && indexedChecksum !== currentChecksum) {
        issues.push({
          kind: 'changed-file',
          severity: 'high',
          file,
          detail: 'file content differs from indexed checksum',
        });
      }

      if (!this.headerStore.exists(file)) {
        issues.push({
          kind: 'missing-header',
          severity: 'medium',
          file,
          detail: 'tracked file has no header metadata',
        });
      }
    }

    const pendingInsights = this.stateStore.getPendingInsightCount();
    if (pendingInsights > 0) {
      issues.push({
        kind: 'pending-insight',
        severity: 'low',
        detail: `${pendingInsights} AI insight items are pending or processing`,
      });
    }

    const stats = this.stateStore.getStats();
    const vectorCount = await this.vectorStore.count();
    if (vectorCount > 0 && vectorCount < stats.totalMethods) {
      issues.push({
        kind: 'vector-mismatch',
        severity: 'medium',
        detail: `vector count ${vectorCount} is lower than indexed method count ${stats.totalMethods}`,
      });
    }

    return {
      ok: issues.filter(issue => issue.severity !== 'low').length === 0,
      stats: {
        trackedFiles: trackedFiles.length,
        changedFiles: issues.filter(issue => issue.kind === 'changed-file').length,
        missingFiles: issues.filter(issue => issue.kind === 'missing-file').length,
        missingHeaders: issues.filter(issue => issue.kind === 'missing-header').length,
        pendingInsights,
        vectorCount,
        totalMethods: stats.totalMethods,
      },
      issues,
      suggestedNext: buildSuggestions(issues),
    };
  }
}

function buildSuggestions(issues: StaleIssue[]): string[] {
  if (issues.some(issue => issue.kind === 'changed-file' || issue.kind === 'missing-file' || issue.kind === 'missing-header')) {
    return ['nc watch -d'];
  }

  if (issues.some(issue => issue.kind === 'vector-mismatch')) {
    return ['nc watch -d'];
  }

  return [];
}
