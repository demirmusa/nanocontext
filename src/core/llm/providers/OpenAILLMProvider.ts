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
    this.model = config.model || 'gpt-5.4-mini';
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
    const response = await this.client.chat.completions.create(
      this.buildChatCompletionRequest(buildFileInsightPrompt(methods, language)),
    );

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
    const response = await this.client.chat.completions.create(
      this.buildChatCompletionRequest(buildSmartSearchPrompt(query, candidates, limit)),
    );

    const content = response.choices[0]?.message?.content?.trim() || '';
    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(candidate => candidate.id)),
      rawResponse: content || '(empty)',
    };
  }

  private buildChatCompletionRequest(
    prompt: string,
    options?: {
      temperature?: number;
    },
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: [
        { role: 'user', content: prompt },
      ],
    };

    if (options?.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    return request;
  }
}
