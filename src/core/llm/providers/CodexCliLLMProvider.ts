import { spawnSync } from 'child_process';
import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt, parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';

export class CodexCliLLMProvider implements ILLMProvider {
  readonly name = 'codex-cli';
  private readonly model: string;

  constructor(config?: { model?: string }) {
    this.model = config?.model || 'gpt-5.4-mini';
  }

  isAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('codex', ['--version'], { encoding: 'utf-8', timeout: 5000, shell: true });
      return Promise.resolve(result.status === 0);
    } catch {
      return Promise.resolve(false);
    }
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const prompt = buildFileInsightPrompt(methods, language);
    const { text, rawStdout } = this.runCodex(prompt);

    return {
      insights: parseInsightResponse(text, methods),
      rawResponse: text || '(empty)',
      prompt,
      rawStdout,
    };
  }

  async selectRelevantSearchResults(
    query: string,
    candidates: SmartSearchCandidate[],
    limit: number,
  ): Promise<SmartSearchSelectionResult> {
    const prompt = buildSmartSearchPrompt(query, candidates, limit);
    const { text } = this.runCodex(prompt);

    return {
      selectedIds: parseSmartSearchResponse(text, candidates.map(c => c.id)),
      rawResponse: text || '(empty)',
    };
  }

  private runCodex(prompt: string): { text: string; rawStdout: string } {
    const result = spawnSync(
      'codex',
      ['--dangerously-bypass-approvals-and-sandbox', 'exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--model', this.model, '-'],
      {
        input: prompt,
        encoding: 'utf-8',
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
        shell: true,
      },
    );

    if (result.error) {
      throw new Error(`codex CLI error: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(`codex exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`);
    }

    const rawStdout = (result.stdout || '').trim();
    const lines = rawStdout.split('\n').filter(l => l.trim());
    let lastText = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
          lastText = event.item.text;
        }
      } catch {
        // ignore non-JSON lines
      }
    }
    return { text: lastText || rawStdout, rawStdout };
  }
}
