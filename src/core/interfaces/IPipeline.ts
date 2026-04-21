import { HeaderJson, SyncResult, SyncStep, ScanProgress, InsightGenerationResult } from './types';

export interface IStructurePipeline {
  processFile(filePath: string, content: string): Promise<HeaderJson>;
  processProject(onProgress?: (progress: ScanProgress) => void): Promise<void>;
  generateInsightsForFile(filePath: string, header: HeaderJson, content?: string, assumeAvailable?: boolean): Promise<InsightGenerationResult | null>;
  syncVectorsForFile(header: HeaderJson): Promise<void>;
}

export interface IInsightPipeline {
  processQueue(onProgress?: (processed: number, total: number) => void): Promise<void>;
  enqueueFile(filePath: string, header: HeaderJson): Promise<void>;
  pause(): void;
  resume(): void;
  readonly isPaused: boolean;
}

export interface ISyncService {
  syncFile(filePath: string, onStep?: (step: SyncStep) => void): Promise<SyncResult>;
  syncFiles(patterns: string[]): Promise<SyncResult[]>;
}
