import { IEmbeddingProvider, IEmbeddingProviderFactory } from '../interfaces/IEmbeddingProvider';
import { EmbeddingConfig } from '../interfaces/types';
import { OllamaEmbeddingProvider } from './providers/OllamaEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';

export class EmbeddingProviderFactory implements IEmbeddingProviderFactory {
  private providerMap = new Map<string, new (config: EmbeddingConfig) => IEmbeddingProvider>();

  constructor() {
    this.providerMap.set('ollama', OllamaEmbeddingProvider);
    this.providerMap.set('openai', OpenAIEmbeddingProvider);
  }

  create(config: EmbeddingConfig): IEmbeddingProvider {
    const ProviderClass = this.providerMap.get(config.provider);
    if (!ProviderClass) {
      throw new Error(`Unknown embedding provider: ${config.provider}. Available: ${this.getAvailableProviders().join(', ')}`);
    }
    return new ProviderClass(config);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providerMap.keys());
  }

  registerProvider(name: string, providerClass: new (config: EmbeddingConfig) => IEmbeddingProvider): void {
    this.providerMap.set(name, providerClass);
  }
}
