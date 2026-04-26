import { spawnSync } from 'child_process';
import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../../interfaces/ILLMProvider';
import { SmartSearchCandidate } from '../../interfaces/types';
import { buildFileInsightPrompt, parseInsightResponse } from '../insightPrompt';
import { buildSmartSearchPrompt, parseSmartSearchResponse } from '../smartSearchPrompt';

export class CodexCliLLMProvider implements ILLMProvider {
  readonly name = 'codex-cli';

  constructor(_config?: unknown) {}

  isAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('codex', ['--version'], { encoding: 'utf-8', timeout: 5000 });
      return Promise.resolve(result.status === 0);
    } catch {
      return Promise.resolve(false);
    }
  }

  async generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    const prompt = buildFileInsightPrompt(methods, language);
    const content = this.runCodex(prompt);

    const methodNames = methods.map(m => m.name).join(', ');
    process.stdout.write(`[codex-cli] ${methods.length} method(s): ${methodNames}\n`);
    process.stdout.write(`[codex-cli] response: ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}\n`);

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
    const content = this.runCodex(prompt);

    return {
      selectedIds: parseSmartSearchResponse(content, candidates.map(c => c.id)),
      rawResponse: content || '(empty)',
    };
  }

  private runCodex(prompt: string): string {
    const result = spawnSync('codex', ['-q', prompt], {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      throw new Error(`codex CLI error: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(`codex exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`);
    }

    return (result.stdout || '').trim();
  }
}
