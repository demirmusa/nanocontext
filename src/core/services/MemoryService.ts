import { IMemoryStore } from '../interfaces/IMemoryStore';
import { MemoryRecord } from '../interfaces/types';
import { IConfigManager } from '../interfaces/IConfigManager';
import { normalizeProjectPath } from '../../utils/projectPath';

export class MemoryService {
  constructor(
    private memoryStore: IMemoryStore,
    private configManager: IConfigManager,
  ) {}

  remember(text: string, ref?: string, file?: string): Promise<MemoryRecord> {
    const normalizedFile = this.normalizeOptionalFile(file ?? ref);
    return this.memoryStore.add(
      text,
      ref,
      normalizedFile,
      normalizedFile ? 'file' : 'project',
    );
  }

  list(search?: string, file?: string): Promise<MemoryRecord[]> {
    return this.memoryStore.list(search, this.normalizeOptionalFile(file));
  }

  listByFile(file: string): Promise<MemoryRecord[]> {
    return this.memoryStore.listByFile(normalizeProjectPath(file, this.configManager.getProjectRoot()));
  }

  forget(id: string): Promise<boolean> {
    return this.memoryStore.remove(id);
  }

  forgetBefore(date: string): Promise<number> {
    return this.memoryStore.removeBefore(date);
  }

  findSimilar(text: string, threshold?: number): Promise<MemoryRecord[]> {
    return this.memoryStore.findSimilar(text, threshold);
  }

  private normalizeOptionalFile(file?: string): string | undefined {
    if (!file) {
      return undefined;
    }

    try {
      return normalizeProjectPath(file, this.configManager.getProjectRoot());
    } catch {
      return undefined;
    }
  }
}
