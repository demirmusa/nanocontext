import { InsightQueueItem, SearchResult, SymbolIndexMetadata } from './types';

export interface IStateStore {
  initialize(): Promise<void>;
  getChecksum(filePath: string): string | null;
  listTrackedFiles(): string[];
  setChecksum(filePath: string, checksum: string): void;
  removeFile(filePath: string): void;

  // Insight queue
  enqueueInsight(item: InsightQueueItem): void;
  dequeueInsight(batchSize: number): InsightQueueItem[];
  completeInsight(file: string, methodId: string): void;
  failInsight(file: string, methodId: string): void;
  getPendingInsightCount(): number;
  isInsightPending(file: string): boolean;

  // Search index
  indexMethod(id: string, file: string, name: string, className: string | undefined, sig: string, loc: string, insight: string | undefined, generationId?: string, metadata?: SymbolIndexMetadata): void;
  indexClass(id: string, file: string, name: string, loc: string, insight: string | undefined, generationId?: string, metadata?: SymbolIndexMetadata): void;
  getFileIndexGenerations?(file: string): string[];
  removeFileIndex(file: string): void;
  searchExact(query: string, limit?: number): SearchResult[];
  searchLexical?(query: string, limit?: number): SearchResult[];
  searchRegex(pattern: string, limit?: number): SearchResult[];

  // Stats
  getStats(): { totalFiles: number; totalMethods: number; lastScanAt: string | null };
  setLastScanAt(date: string): void;
  setTotalMethods(count: number): void;
  clearAll(): void;
  close(): void;
}
