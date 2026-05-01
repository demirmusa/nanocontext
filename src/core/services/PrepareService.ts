import { SearchService } from './SearchService';
import { StaleService } from './StaleService';
import { ImpactService, ImpactReport } from './ImpactService';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { MemoryRecord, SearchResult } from '../interfaces/types';

export interface PrepareReport {
  task: string;
  intent: 'symbol' | 'semantic' | 'trace' | 'dependency' | 'mixed';
  warnings: string[];
  topResults: SearchResult[];
  relatedFiles: string[];
  symbolCandidates: string[];
  impact?: Pick<ImpactReport, 'target' | 'callers' | 'callees' | 'possibleTests' | 'suggestedNext'>;
  memories: MemoryRecord[];
  suggestedNext: string[];
}

export class PrepareService {
  constructor(
    private searchService: SearchService,
    private staleService: StaleService,
    private impactService: ImpactService,
    private memoryStore: IMemoryStore,
  ) {}

  async prepare(task: string, limit: number = 5): Promise<PrepareReport> {
    const intent = classifyPrepareIntent(task);
    const warnings: string[] = [];
    const stale = await this.staleService.inspect();
    if (!stale.ok) {
      warnings.push(`index has ${stale.issues.length} issue(s); run ${stale.suggestedNext[0] ?? 'nc stale'}`);
    }

    const topResults = await this.searchService.execute({
      mode: intent === 'symbol' ? 'exact' : 'vector',
      query: task,
      limit,
      deep: true,
      typeFilter: 'all',
    });

    const relatedFiles = unique(topResults.map(result => result.file).filter(Boolean) as string[]).slice(0, limit);
    const symbolCandidates = unique(topResults
      .filter(result => result.type !== 'memory')
      .map(result => result.class && result.method ? `${result.class}#${result.method}` : result.method ?? result.class)
      .filter(Boolean) as string[])
      .slice(0, limit);

    const impactTarget = symbolCandidates[0] ?? relatedFiles[0];
    const impact = impactTarget ? await this.safeImpact(impactTarget, warnings) : undefined;
    const memories = await this.memoryStore.list(task);

    return {
      task,
      intent,
      warnings,
      topResults,
      relatedFiles,
      symbolCandidates,
      impact: impact ? {
        target: impact.target,
        callers: impact.callers.slice(0, 3),
        callees: impact.callees.slice(0, 3),
        possibleTests: impact.possibleTests.slice(0, 5),
        suggestedNext: impact.suggestedNext.slice(0, 3),
      } : undefined,
      memories: memories.slice(0, 5),
      suggestedNext: buildSuggestedNext(task, topResults, relatedFiles, symbolCandidates, impact),
    };
  }

  private async safeImpact(target: string, warnings: string[]): Promise<ImpactReport | undefined> {
    try {
      return await this.impactService.analyze(target);
    } catch (error) {
      warnings.push(`impact skipped for ${target}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}

export function formatPrepareReport(report: PrepareReport): string {
  const lines: string[] = [`prepare: ${report.task}`, `intent: ${report.intent}`];
  if (report.warnings.length > 0) {
    lines.push(`warnings: ${report.warnings.slice(0, 2).join(' | ')}`);
  }

  const top = report.topResults.slice(0, 3);
  if (top.length > 0) {
    lines.push('');
    lines.push('focus:');
  }
  for (const result of top) {
    const label = result.type === 'memory'
      ? `memory ${result.text ?? result.id ?? ''}`.trim()
      : `${result.file ?? 'unknown'}${result.loc ? `[${result.loc}]` : ''}${result.class || result.method ? ` ${formatResultSymbol(result)}` : ''}`.trim();
    lines.push(`- ${label}`);
  }

  const extraFiles = report.relatedFiles
    .filter(file => !top.some(result => result.file === file))
    .slice(0, 3);
  if (extraFiles.length > 0) {
    lines.push('');
    lines.push('files:');
    for (const file of extraFiles) lines.push(`- ${file}`);
  }

  const topSymbols = new Set(top.map(formatResultSymbol).filter(Boolean));
  const extraSymbols = report.symbolCandidates
    .filter(symbol => !topSymbols.has(symbol))
    .slice(0, 3);
  if (extraSymbols.length > 0) {
    lines.push('');
    lines.push('symbols:');
    for (const symbol of extraSymbols) lines.push(`- ${symbol}`);
  }

  if (report.impact) {
    lines.push('');
    lines.push('impact:');
    if (report.impact.callers.length > 0) lines.push(`- callers: ${report.impact.callers.slice(0, 3).map(item => item.symbol).join(', ')}`);
    if (report.impact.callees.length > 0) lines.push(`- callees: ${report.impact.callees.slice(0, 3).map(item => item.symbol).join(', ')}`);
    if (report.impact.possibleTests.length > 0) lines.push(`- tests: ${report.impact.possibleTests.slice(0, 3).map(item => item.file).join(', ')}`);
  }

  if (report.memories.length > 0) {
    lines.push('');
    lines.push('memories:');
    for (const memory of report.memories) lines.push(`- ${memory.text}`);
  }

  lines.push('');
  lines.push('next:');
  for (const command of compactNextCommands(report.suggestedNext).slice(0, 4)) lines.push(`- ${command}`);

  return lines.join('\n');
}

function classifyPrepareIntent(task: string): PrepareReport['intent'] {
  if (/\b(trace|flow|call chain|execution path)\b/i.test(task)) return 'trace';
  if (/\b(refs|callers|callees|dependency|impact)\b/i.test(task)) return 'dependency';
  if (/^[A-Za-z_][\w.<>#-]*$/.test(task.trim()) && /[A-Z_#.]/.test(task)) return 'symbol';
  if (/\s/.test(task)) return 'semantic';
  return 'mixed';
}

function buildSuggestedNext(
  task: string,
  results: SearchResult[],
  files: string[],
  symbols: string[],
  impact?: Pick<ImpactReport, 'suggestedNext'>,
): string[] {
  return unique([
    ...results.map(result => result.suggestedNext).filter(Boolean) as string[],
    ...files.slice(0, 1).map(file => `nc get ${file}`),
    ...symbols.slice(0, 1).map(symbol => `nc impact ${symbol}`),
    ...(impact?.suggestedNext ?? []),
    `nc search "${task}"`,
  ]).slice(0, 6);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatResultSymbol(result: SearchResult): string {
  if (result.type === 'method') {
    return result.class && result.method ? `${result.class}#${result.method}` : result.method ?? '';
  }
  return result.class ?? '';
}

function compactNextCommands(commands: string[]): string[] {
  const seenKinds = new Set<string>();
  const result: string[] = [];

  for (const command of commands) {
    const kind = command.startsWith('nc get ') ? 'get'
      : command.startsWith('nc impact ') ? 'impact'
        : command.startsWith('nc callers ') ? 'callers'
          : command.startsWith('nc callees ') ? 'callees'
            : command.startsWith('nc search ') ? 'search'
              : command;
    if (seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    result.push(command);
  }

  return result;
}
