import { IEmbeddingProvider } from '../../interfaces/IEmbeddingProvider';
import { EmbeddingConfig } from '../../interfaces/types';

export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;
  private endpoint: string;
  private model: string;

  constructor(config: EmbeddingConfig) {
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.model = config.model || 'nomic-embed-text';
    // nomic-embed-text = 768 dims
    this.dimensions = this.model.includes('nomic') ? 768 : 384;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) throw new Error(`Ollama embedding error: ${response.status}`);
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
