import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { LLMConfig, SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt, parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';

export class AnthropicLLMProvider implements ILLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-haiku-4-5-20251001';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: methods.length * 50,
      messages: [
        { role: 'user', content: buildFileInsightPrompt(methods, language) },
      ],
    });

    const block = response.content[0];
    const content = block.type === 'text' ? block.text.trim() : '';
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
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: Math.max(200, candidates.length * 25),
      messages: [
        { role: 'user', content: buildSmartSearchPrompt(query, candidates, limit) },
      ],
    });

    const block = response.content[0];
    const content = block.type === 'text' ? block.text.trim() : '';
    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(candidate => candidate.id)),
      rawResponse: content,
    };
  }
}
