import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { LLMConfig, SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt, parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';
import { CodexAuthStore } from '../auth/CodexAuthStore';

const CODEX_API_URL = 'https://chatgpt.com/backend-api/codex/responses';

export class CodexOAuthLLMProvider implements ILLMProvider {
  readonly name = 'codex-oauth';
  private readonly model: string;
  private readonly authStore: CodexAuthStore;

  constructor(config: LLMConfig) {
    this.model = config.model || 'gpt-5.4-mini';
    this.authStore = new CodexAuthStore();
  }

  async isAvailable(): Promise<boolean> {
    return this.authStore.isAvailable();
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const prompt = buildFileInsightPrompt(methods, language);
    const content = await this.complete(prompt);
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
    const prompt = buildSmartSearchPrompt(query, candidates, limit);
    const content = await this.complete(prompt);
    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(c => c.id)),
      rawResponse: content || '(empty)',
    };
  }

  private async complete(prompt: string): Promise<string> {
    const { accessToken, accountId } = await this.authStore.getCredentials();

    const res = await fetch(CODEX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'Content-Type': 'application/json',
        'originator': 'opencode',
      },
      body: JSON.stringify({
        model: this.model,
        instructions: 'You are a code analysis assistant.',
        input: [{ role: 'user', content: prompt }],
        store: false,
        stream: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Codex API error (${res.status}): ${body}`);
    }

    return this.parseSSEStream(res);
  }

  private async parseSSEStream(res: Response): Promise<string> {
    const body = res.body;
    if (!body) return '';

    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    let result = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as {
              type?: string;
              delta?: string;
              text?: string;
              output?: Array<{ type: string; role?: string; content?: Array<{ type: string; text?: string }> }>;
            };

            if (event.type === 'response.output_text.delta' && event.delta) {
              result += event.delta;
            } else if (event.type === 'response.output_text.done' && event.text) {
              result = event.text;
            } else if (event.type === 'response.completed' && event.output) {
              for (const item of event.output) {
                if (item.type === 'message' && item.role === 'assistant') {
                  for (const part of item.content ?? []) {
                    if (part.type === 'output_text' && part.text) {
                      result = part.text;
                    }
                  }
                }
              }
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return result.trim();
  }
}
