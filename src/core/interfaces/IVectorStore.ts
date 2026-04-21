import { VectorRecord, SearchResult } from './types';

export interface IVectorStore {
  initialize(dimensions: number): Promise<void>;
  upsert(records: VectorRecord[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  removeByFile(filePath: string): Promise<void>;
  search(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<SearchResult[]>;
  clear(): Promise<void>;
  count(): Promise<number>;
}
