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
    parseFailures: number;
    unsupportedFiles: number;
    pendingInsights: number;
    staleInsights: number;
    missingVectors: number;
    orphanVectors: number;
    vectorCount: number;
    totalMethods: number;
    lastScanAt: string | null;
  };
  categories: Record<string, StaleIssue[]>;
  issues: StaleIssue[];
  suggestedNext: string[];
}

export interface StaleIssue {
  kind:
    | 'changed-file'
    | 'missing-file'
    | 'missing-header'
    | 'missing-vector'
    | 'orphan-vector'
    | 'vector-mismatch'
    | 'parse-failed'
    | 'unsupported-extension'
    | 'pending-insight'
    | 'stale-insight'
    | 'checksum-mismatch'
    | 'scan-generation-mismatch';
  category: 'files' | 'headers' | 'vectors' | 'parser' | 'insights' | 'generation';
  severity: 'high' | 'medium' | 'low';
  file?: string;
  symbol?: string;
  detail: string;
  action: string;
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
    const config = await this.configManager.loadProjectConfig();
    const trackedFiles = this.stateStore.listTrackedFiles().sort((a, b) => a.localeCompare(b));
    const supportedExtensions = supportedExtensionsFor(config.languages);
    let staleInsights = 0;

    for (const file of trackedFiles) {
      const { absolutePath } = resolveProjectPath(file, this.configManager.getProjectRoot());
      if (!fs.existsSync(absolutePath)) {
        issues.push({
          kind: 'missing-file',
          category: 'files',
          severity: 'high',
          file,
          detail: 'indexed file no longer exists on disk',
          action: 'nc scan',
        });
        continue;
      }

      if (!isSupportedFile(file, supportedExtensions)) {
        issues.push({
          kind: 'unsupported-extension',
          category: 'parser',
          severity: 'low',
          file,
          detail: 'tracked file extension is not enabled by the project language config',
          action: 'update nanocontextconfig.json include/languages or remove the stale index entry with nc scan',
        });
      }

      const currentChecksum = computeChecksum(fs.readFileSync(absolutePath, 'utf-8'));
      const indexedChecksum = this.stateStore.getChecksum(file);
      if (indexedChecksum && indexedChecksum !== currentChecksum) {
        issues.push({
          kind: 'changed-file',
          category: 'files',
          severity: 'high',
          file,
          detail: 'file content differs from indexed checksum',
          action: 'nc watch -d or nc scan',
        });
        issues.push({
          kind: 'checksum-mismatch',
          category: 'generation',
          severity: 'medium',
          file,
          detail: `stored checksum ${indexedChecksum.slice(0, 8)} does not match current checksum ${currentChecksum.slice(0, 8)}`,
          action: 'nc scan',
        });
      }

      if (!this.headerStore.exists(file)) {
        issues.push({
          kind: 'missing-header',
          category: 'headers',
          severity: 'medium',
          file,
          detail: 'tracked file has no header metadata',
          action: 'nc scan',
        });
        issues.push({
          kind: 'parse-failed',
          category: 'parser',
          severity: 'medium',
          file,
          detail: 'file is tracked but no parse header is available',
          action: 'nc scan --verbose',
        });
        continue;
      }

      const header = await this.headerStore.read(file);
      if (config.aiInsight && header) {
        for (const method of header.methods) {
          if (!method.insight) {
            staleInsights++;
            issues.push({
              kind: 'stale-insight',
              category: 'insights',
              severity: 'low',
              file,
              symbol: method.class ? `${method.class}#${method.name}` : method.name,
              detail: 'method is missing AI insight while aiInsight is enabled',
              action: 'nc scan',
            });
          }
        }
      }
    }

    const pendingInsights = this.stateStore.getPendingInsightCount();
    if (pendingInsights > 0) {
      issues.push({
        kind: 'pending-insight',
        category: 'insights',
        severity: 'low',
        detail: `${pendingInsights} AI insight items are pending or processing`,
        action: 'wait for nc watch -d or rerun nc scan',
      });
    }

    const stats = this.stateStore.getStats();
    const vectorCount = await this.vectorStore.count();
    const missingVectors = Math.max(0, stats.totalMethods - vectorCount);
    const orphanVectors = Math.max(0, vectorCount - stats.totalMethods);
    if (missingVectors > 0) {
      issues.push({
        kind: 'missing-vector',
        category: 'vectors',
        severity: 'medium',
        detail: `${missingVectors} indexed methods do not appear to have vectors`,
        action: 'nc scan --rebuild-vectors',
      });
    }
    if (orphanVectors > 0) {
      issues.push({
        kind: 'orphan-vector',
        category: 'vectors',
        severity: 'medium',
        detail: `${orphanVectors} vectors do not map to indexed methods`,
        action: 'nc scan --rebuild-vectors',
      });
    }
    if (vectorCount !== stats.totalMethods) {
      issues.push({
        kind: 'vector-mismatch',
        category: 'vectors',
        severity: 'medium',
        detail: `vector count ${vectorCount} differs from indexed method count ${stats.totalMethods}`,
        action: 'nc scan --rebuild-vectors',
      });
    }

    if (trackedFiles.length > 0 && !stats.lastScanAt) {
      issues.push({
        kind: 'scan-generation-mismatch',
        category: 'generation',
        severity: 'low',
        detail: 'tracked files exist but last scan generation timestamp is missing',
        action: 'nc scan',
      });
    }

    const categories = groupIssues(issues);
    return {
      ok: issues.filter(issue => issue.severity !== 'low').length === 0,
      stats: {
        trackedFiles: trackedFiles.length,
        changedFiles: issues.filter(issue => issue.kind === 'changed-file').length,
        missingFiles: issues.filter(issue => issue.kind === 'missing-file').length,
        missingHeaders: issues.filter(issue => issue.kind === 'missing-header').length,
        parseFailures: issues.filter(issue => issue.kind === 'parse-failed').length,
        unsupportedFiles: issues.filter(issue => issue.kind === 'unsupported-extension').length,
        pendingInsights,
        staleInsights,
        missingVectors,
        orphanVectors,
        vectorCount,
        totalMethods: stats.totalMethods,
        lastScanAt: stats.lastScanAt,
      },
      categories,
      issues,
      suggestedNext: buildSuggestions(issues),
    };
  }
}

function buildSuggestions(issues: StaleIssue[]): string[] {
  if (issues.some(issue => issue.kind === 'changed-file' || issue.kind === 'missing-file' || issue.kind === 'missing-header')) {
    return ['nc watch -d', 'nc scan'];
  }

  if (issues.some(issue => issue.kind === 'vector-mismatch')) {
    return ['nc scan --rebuild-vectors'];
  }

  return [...new Set(issues.map(issue => issue.action).filter(Boolean))].slice(0, 3);
}

function groupIssues(issues: StaleIssue[]): Record<string, StaleIssue[]> {
  const grouped: Record<string, StaleIssue[]> = {};
  for (const issue of issues) {
    grouped[issue.category] ??= [];
    grouped[issue.category].push(issue);
  }
  return grouped;
}

function supportedExtensionsFor(languages: string[]): Set<string> {
  const extensions = new Set<string>();
  for (const language of languages) {
    switch (language.toLowerCase()) {
      case 'typescript':
        extensions.add('.ts');
        extensions.add('.tsx');
        break;
      case 'javascript':
        extensions.add('.js');
        extensions.add('.jsx');
        extensions.add('.mjs');
        extensions.add('.cjs');
        break;
      case 'csharp':
        extensions.add('.cs');
        break;
    }
  }
  return extensions;
}

function isSupportedFile(file: string, extensions: Set<string>): boolean {
  if (extensions.size === 0) {
    return true;
  }
  const lower = file.toLowerCase();
  return Array.from(extensions).some(extension => lower.endsWith(extension));
}
