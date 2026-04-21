import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { LLMConfig, SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt, parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';

export class OllamaLLMProvider implements ILLMProvider {
  readonly name = 'ollama';
  private endpoint: string;
  private model: string;

  constructor(config: LLMConfig) {
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.model = config.model || 'llama3.2';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildFileInsightPrompt(methods, language),
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as { response: string };
    const content = data.response.trim();
    return {
      insights: parseInsightResponse(content, methods),
      rawResponse: content,
    };
  }

  async selectRelevantSearchResults(
    query: string,
    candidates: SmartSearchCandidate[],
    limit: number,
  ): Promise<SmartSearchSelectionResult> {
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildSmartSearchPrompt(query, candidates, limit),
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as { response: string };
    const content = data.response.trim();
    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(candidate => candidate.id)),
      rawResponse: content,
    };
  }
}
