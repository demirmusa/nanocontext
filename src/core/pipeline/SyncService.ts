import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ISyncService, IStructurePipeline } from '../interfaces/IPipeline';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IVectorStore } from '../interfaces/IVectorStore';
import { IConfigManager } from '../interfaces/IConfigManager';
import { ILogger } from '../interfaces/ILogger';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { SyncResult, SyncStep } from '../interfaces/types';
import { applyHeaderIdentity, buildMethodLocationKey } from '../identity/recordIds';
import { computeChecksum } from '../../utils/checksum';
import { normalizeProjectPath } from '../../utils/projectPath';

export class SyncService implements ISyncService {
  constructor(
    private structurePipeline: IStructurePipeline,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private vectorStore: IVectorStore,
    private configManager: IConfigManager,
    private logger: ILogger,
    private embeddingProvider: IEmbeddingProvider | null = null,
  ) {}

  async syncFile(filePath: string, onStep?: (step: SyncStep) => void): Promise<SyncResult> {
    const step = onStep || (() => {});
    const projectRoot = this.configManager.getProjectRoot();
    const fullPath = path.join(projectRoot, filePath);

    if (!fs.existsSync(fullPath)) {
      const oldHeader = await this.headerStore.read(filePath);
      const removedCount = oldHeader?.methods.length || 0;
      await this.vectorStore.removeByFile(filePath);
      await this.headerStore.remove(filePath);
      this.stateStore.removeFile(filePath);
      this.stateStore.setLastScanAt(new Date().toISOString());
      step('done');
      return { file: filePath, action: 'deleted', methodsUpdated: 0, methodsAdded: 0, methodsRemoved: removedCount };
    }

    step('checksum');
    const content = fs.readFileSync(fullPath, 'utf-8');
    const checksum = computeChecksum(content);
    const existingChecksum = this.stateStore.getChecksum(filePath);
    const hasHeader = this.headerStore.exists(filePath);

    if (existingChecksum === checksum && hasHeader) {
      this.stateStore.setLastScanAt(new Date().toISOString());
      step('done');
      return { file: filePath, action: 'unchanged', methodsUpdated: 0, methodsAdded: 0, methodsRemoved: 0 };
    }

    // Tree-sitter parse
    step('parsing');
    const oldHeader = await this.headerStore.read(filePath);
    const normalizedOldHeader = oldHeader ? applyHeaderIdentity(oldHeader) : null;
    const oldMethodIds = new Set(normalizedOldHeader?.methods.map(m => m.id) ?? []);
    const oldMethodByLocation = new Map<string, string>();
    for (const method of normalizedOldHeader?.methods ?? []) {
      oldMethodByLocation.set(buildMethodLocationKey(filePath, method), method.id);
    }

    const newHeader = await this.structurePipeline.processFile(filePath, content);
    const newMethodIds = new Set(newHeader.methods.map(m => m.id));
    const newMethodByLocation = new Map<string, string>();
    for (const method of newHeader.methods) {
      newMethodByLocation.set(buildMethodLocationKey(filePath, method), method.id);
    }

    let added = 0, updated = 0, removed = 0;

    for (const method of newHeader.methods) {
      if (oldMethodIds.has(method.id)) {
        continue;
      }

      const priorMethodId = oldMethodByLocation.get(buildMethodLocationKey(filePath, method));
      if (priorMethodId) {
        updated++;
      } else {
        added++;
      }
    }

    for (const oldMethod of normalizedOldHeader?.methods ?? []) {
      if (!newMethodIds.has(oldMethod.id) && !newMethodByLocation.has(buildMethodLocationKey(filePath, oldMethod))) {
        removed++;
      }
    }

    // AI Insight
    step('insight');
    await this.structurePipeline.generateInsightsForFile(filePath, newHeader, content);

    // Vectors
    if (this.embeddingProvider) {
      step('vectors');
      try {
        await this.structurePipeline.syncVectorsForFile(newHeader);
      } catch (err) {
        this.logger.error(`Vector generation failed for ${filePath}:`, err);
      }
    }

    this.stateStore.setLastScanAt(new Date().toISOString());
    step('done');
    const hasStructuralChanges = added > 0 || updated > 0 || removed > 0;
    return { file: filePath, action: hasStructuralChanges ? 'indexed' : 'parsed', methodsUpdated: updated, methodsAdded: added, methodsRemoved: removed };
  }

  async syncFiles(patterns: string[]): Promise<SyncResult[]> {
    const projectRoot = this.configManager.getProjectRoot();
    const results: SyncResult[] = [];

    for (const pattern of patterns) {
      const files = await glob(pattern, { cwd: projectRoot, nodir: true });

      for (const file of files.map(item => normalizeProjectPath(item, projectRoot))) {
        try {
          const result = await this.syncFile(file);
          results.push(result);
        } catch (err) {
          this.logger.error(`Failed to sync ${file}:`, err);
        }
      }
    }

    return results;
  }
}
