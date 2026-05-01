import * as path from 'path';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { CodeReadService } from './CodeReadService';
import { DependencyService } from './DependencyService';
import { MemoryRecord, StateReference, TraceRelation } from '../interfaces/types';
import { normalizeProjectPath } from '../../utils/projectPath';

export interface ImpactReport {
  query: string;
  target?: {
    type: 'file' | 'symbol';
    file: string;
    symbol?: string;
    range?: string;
    confidence?: string;
  };
  callers: TraceRelation[];
  callees: TraceRelation[];
  trace: TraceRelation[];
  sameFileSymbols: TraceRelation[];
  stateReferences: StateReference[];
  possibleTests: TestCandidate[];
  memories: MemoryRecord[];
  warnings: string[];
  suggestedNext: string[];
}

export interface TestCandidate {
  file: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export class ImpactService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private memoryStore: IMemoryStore,
    private codeReadService: CodeReadService,
    private dependencyService: DependencyService,
  ) {}

  async analyze(target: string): Promise<ImpactReport> {
    const query = target.trim();
    const warnings: string[] = [];

    if (!query) {
      return this.emptyReport(target, ['empty target']);
    }

    if (this.codeReadService.isLikelyFilePath(query)) {
      return this.analyzeFile(query, warnings);
    }

    return this.analyzeSymbol(query, warnings);
  }

  private async analyzeFile(target: string, warnings: string[]): Promise<ImpactReport> {
    const projectRoot = this.configManager.getProjectRoot();
    const file = normalizeProjectPath(target, projectRoot);
    const header = await this.headerStore.read(file);
    if (!header) {
      warnings.push(`No header found for ${file}.`);
    }

    const methods = header?.methods.slice(0, 5) ?? [];
    const callers = await this.collectSymbolRelations(methods.map(method => method.class ? `${method.class}#${method.name}` : method.name), 'callers');
    const callees = await this.collectSymbolRelations(methods.map(method => method.class ? `${method.class}#${method.name}` : method.name), 'callees');
    const stateReferences = (this.stateStore.listStateReferences?.(file, undefined, 50) ?? [])
      .filter(ref => ref.file === file)
      .slice(0, 12);

    return {
      query: target,
      target: { type: 'file', file },
      callers,
      callees,
      trace: [],
      sameFileSymbols: this.sameFileSymbols(file, header?.methods.map(method => method.loc) ?? []),
      stateReferences,
      possibleTests: this.findPossibleTests(file, header?.methods.map(method => method.name) ?? []),
      memories: await this.memoryStore.listByFile(file),
      warnings,
      suggestedNext: this.suggestNext(file, callers, callees),
    };
  }

  private async analyzeSymbol(target: string, warnings: string[]): Promise<ImpactReport> {
    const resolution = await this.codeReadService.resolveSymbolTarget(target);
    if (!resolution.matched || resolution.ambiguous) {
      return this.emptyReport(target, [
        resolution.reason || `No indexed symbol match found for ${target}.`,
      ]);
    }

    const matched = resolution.matched;
    const symbol = matched.display;
    const [callersSurface, calleesSurface, traceSurface] = await Promise.all([
      this.dependencyService.getCallers(symbol),
      this.dependencyService.getCallees(symbol),
      this.dependencyService.traceSymbol(symbol, 3),
    ]);

    for (const surface of [callersSurface, calleesSurface, traceSurface]) {
      if (surface.warning) warnings.push(surface.warning);
    }

    const symbolId = `${matched.file}:${matched.loc}:${matched.type}:${matched.symbol}`;
    const symbolMemories = await this.memoryStore.listBySymbol(symbolId);
    const fileMemories = symbolMemories.length > 0 ? [] : await this.memoryStore.listByFile(matched.file);
    const stateReferences = (this.stateStore.listStateReferences?.(symbol, undefined, 50) ?? [])
      .filter(ref => ref.symbol === symbol || ref.file === matched.file)
      .slice(0, 12);

    return {
      query: target,
      target: {
        type: 'symbol',
        file: matched.file,
        symbol,
        range: matched.loc,
        confidence: matched.confidence,
      },
      callers: callersSurface.results,
      callees: calleesSurface.results,
      trace: traceSurface.results,
      sameFileSymbols: this.sameFileSymbols(matched.file, [matched.loc]),
      stateReferences,
      possibleTests: this.findPossibleTests(matched.file, [symbol, matched.symbol]),
      memories: [...symbolMemories, ...fileMemories].slice(0, 8),
      warnings,
      suggestedNext: this.suggestNext(symbol, callersSurface.results, calleesSurface.results),
    };
  }

  private async collectSymbolRelations(symbols: string[], mode: 'callers' | 'callees'): Promise<TraceRelation[]> {
    const all: TraceRelation[] = [];
    for (const symbol of symbols) {
      const surface = mode === 'callers'
        ? await this.dependencyService.getCallers(symbol)
        : await this.dependencyService.getCallees(symbol);
      all.push(...surface.results);
    }
    return dedupeRelations(all).slice(0, 8);
  }

  private sameFileSymbols(file: string, excludedRanges: string[]): TraceRelation[] {
    const results = this.stateStore.searchExact(file, 50)
      .filter(result => result.file === file && result.loc && !excludedRanges.includes(result.loc))
      .map(result => ({
        symbol: result.type === 'method'
          ? (result.class ? `${result.class}#${result.method}` : result.method || result.id || file)
          : result.class || result.id || file,
        path: file,
        range: result.loc || '?',
        confidence: 'medium' as const,
        kind: 'candidate' as const,
        reason: 'same indexed file',
      }));
    return dedupeRelations(results).slice(0, 8);
  }

  private findPossibleTests(file: string, symbols: string[]): TestCandidate[] {
    const trackedFiles = this.stateStore.listTrackedFiles();
    const fileBase = stripTestWords(path.basename(file, path.extname(file))).toLowerCase();
    const symbolTokens = symbols.flatMap(symbol => splitSymbolTokens(symbol));
    const candidates: Array<TestCandidate & { score: number }> = [];

    for (const candidateFile of trackedFiles) {
      const normalized = candidateFile.replace(/\\/g, '/');
      if (!isTestPath(normalized)) continue;

      const haystack = stripTestWords(normalized).toLowerCase();
      let score = 20;
      const reasons: string[] = ['test path convention'];

      if (fileBase && haystack.includes(fileBase)) {
        score += 50;
        reasons.push(`matches file name ${fileBase}`);
      }

      const matchedSymbol = symbolTokens.find(token => token.length >= 3 && haystack.includes(token));
      if (matchedSymbol) {
        score += 30;
        reasons.push(`matches symbol token ${matchedSymbol}`);
      }

      candidates.push({
        file: candidateFile,
        confidence: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
        reason: reasons.join('; '),
        score,
      });
    }

    return candidates
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, 8)
      .map(({ score: _score, ...candidate }) => candidate);
  }

  private suggestNext(target: string, callers: TraceRelation[], callees: TraceRelation[]): string[] {
    const suggestions = [`nc get ${target}`];
    if (callers.length > 0) suggestions.push(`nc callers ${target}`);
    if (callees.length > 0) suggestions.push(`nc callees ${target}`);
    return suggestions.slice(0, 3);
  }

  private emptyReport(query: string, warnings: string[]): ImpactReport {
    return {
      query,
      callers: [],
      callees: [],
      trace: [],
      sameFileSymbols: [],
      stateReferences: [],
      possibleTests: [],
      memories: [],
      warnings,
      suggestedNext: [`nc search "${query}"`],
    };
  }
}

function isTestPath(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.includes('__tests__/')
    || lower.includes('/test/')
    || lower.includes('/tests/')
    || lower.includes('.test.')
    || lower.includes('.spec.')
    || /tests?\.[^.]+$/.test(lower)
    || /test(s)?\.[^.]+$/.test(path.basename(lower));
}

function stripTestWords(value: string): string {
  return value
    .replace(/\.(test|spec)\./gi, '.')
    .replace(/tests?/gi, '')
    .replace(/__tests__/gi, '');
}

function splitSymbolTokens(symbol: string): string[] {
  return symbol
    .replace(/[#.]/g, ' ')
    .split(/[^A-Za-z0-9]+|(?=[A-Z])/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);
}

function dedupeRelations(relations: TraceRelation[]): TraceRelation[] {
  const seen = new Set<string>();
  return relations.filter(relation => {
    const key = `${relation.path}:${relation.range}:${relation.symbol}:${relation.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
