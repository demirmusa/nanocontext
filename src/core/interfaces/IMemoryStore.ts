import { MemoryRecord } from './types';

export interface IMemoryStore {
  add(text: string, ref?: string): Promise<MemoryRecord>;
  list(search?: string): Promise<MemoryRecord[]>;
  remove(id: string): Promise<boolean>;
  removeBefore(date: string): Promise<number>;
  findSimilar(text: string, threshold?: number, limit?: number): Promise<MemoryRecord[]>;
  close(): void;
}
