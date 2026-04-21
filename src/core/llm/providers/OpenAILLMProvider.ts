import OpenAI from 'openai';
import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { LLMConfig, SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt } from '../insightPrompt';
import { parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';

export class OpenAILLMProvider implements ILLMProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-5-mini-2025-08-07';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'user', content: buildFileInsightPrompt(methods, language) },
      ],
      temperature: 1,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';

    return {
      insights: parseInsightResponse(content, methods),
      rawResponse: content || '(empty)',
    };
  }

  async selectRelevantSearchResults(
    query: string,
    candidates: SmartSearchCandidate[],
    limit: number,
  ): Promise<SmartSearchSelectionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'user', content: buildSmartSearchPrompt(query, candidates, limit) },
      ],
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(candidate => candidate.id)),
      rawResponse: content || '(empty)',
    };
  }
}
