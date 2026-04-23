import { MemoryRecord } from './types';

export interface IMemoryStore {
  add(text: string, ref?: string, file?: string, scope?: 'project' | 'file' | 'symbol', symbol?: string, symbolId?: string): Promise<MemoryRecord>;
  list(search?: string, file?: string, symbolId?: string): Promise<MemoryRecord[]>;
  listByFile(file: string): Promise<MemoryRecord[]>;
  listBySymbol(symbolId: string): Promise<MemoryRecord[]>;
  remove(id: string): Promise<boolean>;
  removeBefore(date: string): Promise<number>;
  findSimilar(text: string, threshold?: number, limit?: number): Promise<MemoryRecord[]>;
  close(): void;
}
