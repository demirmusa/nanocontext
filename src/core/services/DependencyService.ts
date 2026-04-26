import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { MethodInfo, SearchResult, TraceRelation, TraceSurfaceResult } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';
import { normalizeProjectPath } from '../../utils/projectPath';
import { CodeReadService } from './CodeReadService';

export class DependencyService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private codeReadService: CodeReadService,
  ) {}

  async getRefs(filePath: string, methodSelector: string, depth?: number): Promise<string[]> {
    const normalizedPath = normalizeProjectPath(filePath, this.configManager.getProjectRoot());
    const header = await this.headerStore.read(normalizedPath);
    if (!header) return [];

    const normalizedHeader = applyHeaderIdentity(header);
    const maxDepth = Math.max(1, Math.min(depth ?? 1, 3));
    const rootMethods = this.resolveMethods(normalizedHeader.methods, methodSelector);
    if (rootMethods.length === 0) return [];

    const refs = new Set<string>();
    const visited = new Set<string>();

    const visit = (method: MethodInfo, currentDepth: number): void => {
      if (visited.has(method.id) || currentDepth > maxDepth) return;
      visited.add(method.id);

      for (const ref of method.refs) {
        refs.add(ref);
        if (currentDepth < maxDepth) {
          const nextMethods = this.resolveRefMethods(normalizedHeader.methods, ref);
          for (const nextMethod of nextMethods) {
            visit(nextMethod, currentDepth + 1);
          }
        }
      }
    };

    for (const root of rootMethods) {
      visit(root, 1);
    }

    return Array.from(refs).sort();
  }

  async getRefsForSymbol(symbol: string, depth?: number): Promise<string[]> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) return [];
    return this.getRefs(resolved.file, resolved.selector, depth);
  }

  async getCallers(symbol: string): Promise<TraceSurfaceResult> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) {
      return this.buildUnresolvedSurface(symbol, 'callers');
    }

    const callers: TraceRelation[] = [];
    const targetCandidates = this.buildMethodCandidateSet(resolved.method, resolved.selector);

    for (const file of this.stateStore.listTrackedFiles()) {
      const header = await this.headerStore.read(file);
      if (!header) continue;

      const normalizedHeader = applyHeaderIdentity(header);
      for (const method of normalizedHeader.methods) {
        const matchedRefs = (method.refs ?? []).filter(ref => this.referenceMatchesCandidates(ref, targetCandidates));
        if (matchedRefs.length === 0) {
          continue;
        }
        callers.push(this.toRelation(file, method, 'caller', {
          confidence: this.scoreConfidence(matchedRefs, targetCandidates),
          reason: `matched refs: ${matchedRefs.slice(0, 2).join(', ')}`,
        }));
      }
    }

    callers.sort((a, b) => compareRelations(a, b));
    return {
      target: this.toRelation(resolved.file, resolved.method, 'candidate', {
        confidence: 'high',
        reason: `resolved from ${resolved.matchSource}`,
      }),
      results: callers.slice(0, 5),
      related: callers.slice(5, 8),
      suggestedNext: callers[0] ? `nc get ${callers[0].symbol}` : `nc callees ${resolved.displaySymbol}`,
      warning: resolved.warning,
    };
  }

  async getCallees(symbol: string): Promise<TraceSurfaceResult> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) {
      return this.buildUnresolvedSurface(symbol, 'callees');
    }

    const results: TraceRelation[] = [];
    const related: TraceRelation[] = [];
    const seen = new Set<string>();

    for (const ref of resolved.method.refs ?? []) {
      const match = await this.resolveSymbol(ref, { limit: 5 });
      if (match) {
        const relation = this.toRelation(match.file, match.method, 'callee', {
          confidence: match.displaySymbol === ref || this.buildSelectorSet(match.method).has(ref) ? 'high' : 'medium',
          reason: `resolved from ref ${ref}`,
        });
        const key = `${relation.path}:${relation.symbol}:${relation.range}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(relation);
        }
        continue;
      }

      const fallback = this.toFallbackRelation(ref, resolved.file);
      const key = `${fallback.path}:${fallback.symbol}:${fallback.range}`;
      if (!seen.has(key)) {
        seen.add(key);
        related.push(fallback);
      }
    }

    results.sort((a, b) => compareRelations(a, b));
    related.sort((a, b) => compareRelations(a, b));

    return {
      target: this.toRelation(resolved.file, resolved.method, 'candidate', {
        confidence: 'high',
        reason: `resolved from ${resolved.matchSource}`,
      }),
      results: results.slice(0, 5),
      related: related.slice(0, 5),
      suggestedNext: results[0] ? `nc get ${results[0].symbol}` : `nc refs ${resolved.displaySymbol}`,
      warning: resolved.warning,
    };
  }

  async traceSymbol(symbol: string, depth?: number): Promise<TraceSurfaceResult> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) {
      return this.buildUnresolvedSurface(symbol, 'trace');
    }

    const steps: TraceRelation[] = [];
    const related: TraceRelation[] = [];
    const maxDepth = Math.max(1, Math.min(depth ?? 3, 5));
    const visited = new Set<string>();

    const visit = async (file: string, method: MethodInfo, currentDepth: number): Promise<void> => {
      const key = `${file}:${method.id}`;
      if (visited.has(key) || currentDepth > maxDepth) return;
      visited.add(key);

      steps.push(this.toRelation(file, method, 'trace', {
        confidence: currentDepth === 1 ? 'high' : 'medium',
        reason: currentDepth === 1 ? 'trace root' : `hop ${currentDepth}`,
      }));

      if (currentDepth === maxDepth) return;
      for (const ref of method.refs) {
        const next = await this.resolveSymbol(ref);
        if (next) {
          await visit(next.file, next.method, currentDepth + 1);
        } else {
          related.push(this.toFallbackRelation(ref, file));
        }
      }
    };

    await visit(resolved.file, resolved.method, 1);
    const dedupedRelated = dedupeRelations(related).filter(item =>
      !steps.some(step => sameRelation(step, item)),
    );
    return {
      target: this.toRelation(resolved.file, resolved.method, 'candidate', {
        confidence: 'high',
        reason: `resolved from ${resolved.matchSource}`,
      }),
      results: steps.slice(0, maxDepth),
      related: dedupedRelated.slice(0, 5),
      suggestedNext: steps[1] ? `nc get ${steps[1].symbol}` : `nc callees ${resolved.displaySymbol}`,
      warning: resolved.warning,
    };
  }

  private resolveMethods(methods: MethodInfo[], selector: string): MethodInfo[] {
    const normalizedSelector = selector.trim();
    if (!normalizedSelector) return [];

    return methods.filter(method => this.buildSelectorSet(method).has(normalizedSelector));
  }

  private async resolveSymbol(
    symbol: string,
    options: { limit?: number } = {},
  ): Promise<ResolvedMethod | null> {
    const rawSymbol = symbol.trim();
    if (!rawSymbol) {
      return null;
    }

    const sharedResolution = await this.codeReadService.resolveSymbolTarget(rawSymbol);
    if (sharedResolution.matched && !sharedResolution.ambiguous) {
      const header = await this.headerStore.read(sharedResolution.matched.file);
      if (header) {
        const normalizedHeader = applyHeaderIdentity(header);
        const method = normalizedHeader.methods.find(item => item.loc === sharedResolution.matched?.loc && item.sig === sharedResolution.matched?.sig)
          ?? normalizedHeader.methods.find(item => item.loc === sharedResolution.matched?.loc);
        if (method) {
          return {
            file: sharedResolution.matched.file,
            method,
            selector: rawSymbol,
            displaySymbol: sharedResolution.matched.display,
            matchSource: sharedResolution.matched.matchType ?? 'symbol',
            score: sharedResolution.matched.confidence === 'high' ? 120 : sharedResolution.matched.confidence === 'medium' ? 90 : 70,
            warning: sharedResolution.reason,
          };
        }
      }
    }

    const limit = Math.max(3, options.limit ?? 10);
    const candidates = dedupeSearchResults([
      ...this.stateStore.searchExact(rawSymbol, limit),
      ...this.stateStore.searchRegex(escapeRegex(rawSymbol), limit),
    ]);

    if (candidates.length === 0) {
      return null;
    }

    const ranked: ResolvedMethod[] = [];
    for (const candidate of candidates) {
      if (!candidate.file || candidate.type !== 'method') {
        continue;
      }
      const header = await this.headerStore.read(candidate.file);
      if (!header) continue;
      const normalizedHeader = applyHeaderIdentity(header);
      const directMatches = this.resolveMethods(normalizedHeader.methods, rawSymbol);
      for (const method of directMatches) {
        ranked.push(this.toResolvedMethod(candidate.file, method, rawSymbol, candidate, true));
      }

      const fallback = normalizedHeader.methods.find(method => method.id === candidate.id || method.loc === candidate.loc);
      if (fallback) {
        ranked.push(this.toResolvedMethod(candidate.file, fallback, rawSymbol, candidate, false));
      }
    }

    if (ranked.length === 0) {
      return null;
    }

    ranked.sort((a, b) => compareResolvedMethods(a, b));
    const [best, ...rest] = dedupeResolvedMethods(ranked);
    return {
      ...best,
      warning: rest.length > 0
        ? `Ambiguous symbol: ${rawSymbol}. Top candidates: ${rest.slice(0, 2).map(item => `${item.displaySymbol} ${item.file}[${item.method.loc}]`).join('; ')}.`
        : undefined,
    };
  }

  private resolveRefMethods(methods: MethodInfo[], ref: string): MethodInfo[] {
    const candidates = this.expandReferenceCandidates(ref);
    return methods.filter(method => {
      const selectors = this.buildSelectorSet(method);
      for (const candidate of candidates) {
        if (selectors.has(candidate)) {
          return true;
        }
      }
      return false;
    });
  }

  private buildSelectorSet(method: MethodInfo): Set<string> {
    const selectors = new Set<string>([method.id, method.name]);

    if (method.class) {
      selectors.add(`${method.class}.${method.name}`);
      selectors.add(`${method.class}#${method.name}`);
    }

    return selectors;
  }

  private expandReferenceCandidates(ref: string): Set<string> {
    const normalizedRef = ref.trim().replace(/\?\./g, '.');
    const candidates = new Set<string>([normalizedRef]);
    const dotSegments = normalizedRef.split('.');

    if (dotSegments.length > 1) {
      candidates.add(dotSegments[dotSegments.length - 1]);
      candidates.add(dotSegments.slice(-2).join('.'));
    }

    if (normalizedRef.startsWith('this.')) {
      candidates.add(normalizedRef.slice('this.'.length));
    }

    if (normalizedRef.startsWith('super.')) {
      candidates.add(normalizedRef.slice('super.'.length));
    }

    if (normalizedRef.includes('#')) {
      const hashSegments = normalizedRef.split('#');
      candidates.add(hashSegments[hashSegments.length - 1]);
      if (hashSegments.length > 1) {
        candidates.add(hashSegments.slice(-2).join('#'));
      }
    }

    return candidates;
  }

  private buildMethodCandidateSet(method: MethodInfo, selector: string): Set<string> {
    const candidates = new Set<string>([selector, ...this.buildSelectorSet(method)]);
    for (const candidate of [...candidates]) {
      for (const expanded of this.expandReferenceCandidates(candidate)) {
        candidates.add(expanded);
      }
    }
    return candidates;
  }

  private referenceMatchesCandidates(ref: string, candidates: Set<string>): boolean {
    for (const expanded of this.expandReferenceCandidates(ref)) {
      if (candidates.has(expanded)) {
        return true;
      }
    }
    return false;
  }

  private scoreConfidence(refs: string[], candidates: Set<string>): TraceRelation['confidence'] {
    if (refs.some(ref => candidates.has(ref))) {
      return 'high';
    }
    if (refs.some(ref => [...this.expandReferenceCandidates(ref)].some(candidate => candidates.has(candidate)))) {
      return 'medium';
    }
    return 'low';
  }

  private toRelation(
    file: string,
    method: MethodInfo,
    kind: TraceRelation['kind'],
    details: { confidence: TraceRelation['confidence']; reason?: string },
  ): TraceRelation {
    return {
      symbol: method.class ? `${method.class}#${method.name}` : method.name,
      path: file,
      range: method.loc,
      confidence: details.confidence,
      kind,
      reason: details.reason,
    };
  }

  private toFallbackRelation(symbol: string, path: string): TraceRelation {
    return {
      symbol,
      path,
      range: '?',
      confidence: 'missing-index',
      kind: 'candidate',
      reason: 'missing indexed symbol data',
    };
  }

  private buildUnresolvedSurface(symbol: string, mode: 'callers' | 'callees' | 'trace'): TraceSurfaceResult {
    return {
      results: [],
      related: [],
      suggestedNext: `nc search "${symbol}"`,
      warning: `No indexed symbol match found for ${symbol}. Re-run \`nc scan\` if the file was added recently, or search for the symbol first before using \`nc ${mode}\`.`,
    };
  }

  private toResolvedMethod(
    file: string,
    method: MethodInfo,
    selector: string,
    candidate: SearchResult,
    directMatch: boolean,
  ): ResolvedMethod {
    const candidateSymbol = method.class ? `${method.class}#${method.name}` : method.name;
    const score = scoreMethodMatch(method, selector, candidate, directMatch);
    return {
      file,
      method,
      selector,
      displaySymbol: candidateSymbol,
      matchSource: directMatch ? 'symbol' : 'index fallback',
      score,
    };
  }
}

interface ResolvedMethod {
  file: string;
  method: MethodInfo;
  selector: string;
  displaySymbol: string;
  matchSource: string;
  score: number;
  warning?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreMethodMatch(method: MethodInfo, selector: string, candidate: SearchResult, directMatch: boolean): number {
  const normalizedSelector = selector.toLowerCase();
  const methodName = method.name.toLowerCase();
  const classMethodDot = method.class ? `${method.class}.${method.name}`.toLowerCase() : '';
  const classMethodHash = method.class ? `${method.class}#${method.name}`.toLowerCase() : '';

  if (method.id.toLowerCase() === normalizedSelector) return 120;
  if (classMethodHash === normalizedSelector) return 110;
  if (classMethodDot === normalizedSelector) return 108;
  if (methodName === normalizedSelector) return 100;
  if (directMatch) return 90;
  if (candidate.method?.toLowerCase() === normalizedSelector) return 80;
  return 60;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = `${result.type}:${result.file ?? ''}:${result.id ?? ''}:${result.loc ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compareResolvedMethods(a: ResolvedMethod, b: ResolvedMethod): number {
  return b.score - a.score || a.file.localeCompare(b.file) || a.method.loc.localeCompare(b.method.loc);
}

function dedupeResolvedMethods(results: ResolvedMethod[]): ResolvedMethod[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = `${result.file}:${result.method.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compareRelations(a: TraceRelation, b: TraceRelation): number {
  return confidenceRank(a.confidence) - confidenceRank(b.confidence)
    || a.path.localeCompare(b.path)
    || a.range.localeCompare(b.range)
    || a.symbol.localeCompare(b.symbol);
}

function confidenceRank(confidence: TraceRelation['confidence']): number {
  switch (confidence) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
    default:
      return 3;
  }
}

function dedupeRelations(results: TraceRelation[]): TraceRelation[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = `${result.kind}:${result.path}:${result.range}:${result.symbol}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sameRelation(a: TraceRelation, b: TraceRelation): boolean {
  return a.path === b.path && a.range === b.range && a.symbol === b.symbol;
}
