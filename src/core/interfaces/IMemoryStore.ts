import { MemoryRecord } from './types';

export interface IMemoryStore {
  add(text: string, ref?: string, file?: string, scope?: 'project' | 'file'): Promise<MemoryRecord>;
  list(search?: string, file?: string): Promise<MemoryRecord[]>;
  listByFile(file: string): Promise<MemoryRecord[]>;
  remove(id: string): Promise<boolean>;
  removeBefore(date: string): Promise<number>;
  findSimilar(text: string, threshold?: number, limit?: number): Promise<MemoryRecord[]>;
  close(): void;
}
