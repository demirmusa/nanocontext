import { IMemoryStore } from '../interfaces/IMemoryStore';
import { MemoryRecord, SymbolResolution } from '../interfaces/types';
import { IConfigManager } from '../interfaces/IConfigManager';
import { normalizeProjectPath } from '../../utils/projectPath';
import { CodeReadService } from './CodeReadService';

export class MemoryService {
  constructor(
    private memoryStore: IMemoryStore,
    private configManager: IConfigManager,
    private codeReadService: CodeReadService,
  ) {}

  async remember(text: string, ref?: string, file?: string, symbol?: string): Promise<MemoryRecord> {
    if (symbol) {
      const resolution = await this.codeReadService.resolveSymbolTarget(symbol);
      if (!resolution.matched || resolution.ambiguous) {
        throw new Error(buildSymbolMemoryError(symbol, resolution));
      }
      return this.memoryStore.add(
        text,
        ref,
        resolution.matched.file,
        'symbol',
        resolution.matched.display,
        buildSymbolId(resolution.matched),
      );
    }

    const normalizedFile = this.normalizeOptionalFile(file ?? ref);
    return this.memoryStore.add(
      text,
      ref,
      normalizedFile,
      normalizedFile ? 'file' : 'project',
    );
  }

  async list(search?: string, file?: string, symbol?: string): Promise<MemoryRecord[]> {
    const symbolId = symbol ? await this.resolveSymbolId(symbol) : undefined;
    return this.memoryStore.list(search, this.normalizeOptionalFile(file), symbolId);
  }

  listByFile(file: string): Promise<MemoryRecord[]> {
    return this.memoryStore.listByFile(normalizeProjectPath(file, this.configManager.getProjectRoot()));
  }

  async listBySymbol(symbol: string): Promise<MemoryRecord[]> {
    const symbolId = await this.resolveSymbolId(symbol);
    if (!symbolId) {
      return [];
    }
    return this.memoryStore.listBySymbol(symbolId);
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

  private async resolveSymbolId(symbol: string): Promise<string | undefined> {
    const resolution = await this.codeReadService.resolveSymbolTarget(symbol);
    if (!resolution.matched || resolution.ambiguous) {
      return undefined;
    }
    return buildSymbolId(resolution.matched);
  }
}

function buildSymbolId(symbol: { file: string; loc: string; type: string; display?: string }): string {
  return `${symbol.file}:${symbol.loc}:${symbol.type}:${symbol.display ?? ''}`;
}

function buildSymbolMemoryError(symbol: string, resolution: SymbolResolution): string {
  if (resolution.ambiguous) {
    return `Ambiguous symbol "${symbol}". ${resolution.reason ?? 'Use a qualified name.'}`;
  }
  return `No symbol match found for "${symbol}".`;
}
