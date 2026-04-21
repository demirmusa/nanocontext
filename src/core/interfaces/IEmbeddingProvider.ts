import { EmbeddingConfig } from './types';

export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface IEmbeddingProviderFactory {
  create(config: EmbeddingConfig): IEmbeddingProvider;
  getAvailableProviders(): string[];
}
