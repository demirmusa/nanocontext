import { IEmbeddingProvider } from '../../interfaces/IEmbeddingProvider';
import { EmbeddingConfig } from '../../interfaces/types';

const MAX_OLLAMA_EMBEDDING_PROMPT_CHARS = 2000;
const MIN_OLLAMA_EMBEDDING_PROMPT_CHARS = 250;

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
    let prompt = truncateEmbeddingPrompt(text, MAX_OLLAMA_EMBEDDING_PROMPT_CHARS);

    while (true) {
      const response = await fetch(`${this.endpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt }),
      });

      if (response.ok) {
        const data = await response.json() as { embedding: number[] };
        return data.embedding;
      }

      const detail = await readResponseText(response);
      if (isContextLengthResponse(detail) && prompt.length > MIN_OLLAMA_EMBEDDING_PROMPT_CHARS) {
        prompt = truncateEmbeddingPrompt(prompt, Math.max(MIN_OLLAMA_EMBEDDING_PROMPT_CHARS, Math.floor(prompt.length / 2)));
        continue;
      }

      const message = detail
        ? `Ollama embedding error: ${response.status} ${detail}`
        : `Ollama embedding error: ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

function truncateEmbeddingPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars);
}

function isContextLengthResponse(detail: string): boolean {
  return /input length exceeds the context length|context length/i.test(detail);
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}
