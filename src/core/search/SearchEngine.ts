import { ISearchEngine } from '../interfaces/ISearchEngine';
import { IVectorStore } from '../interfaces/IVectorStore';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { IStateStore } from '../interfaces/IStateStore';
import { ILogger } from '../interfaces/ILogger';
import { SearchResult } from '../interfaces/types';
import { isSearchStopWord } from './search-stop-words';

type SearchSignal = 'exact' | 'lexical' | 'regex' | 'vector' | 'memory' | 'path';

interface RankedCandidate {
  result: SearchResult;
  score: number;
  baseScore: number;
  signals: Set<SearchSignal>;
  matchedBy: Set<NonNullable<SearchResult['matchedBy']>[number]>;
  scoreParts: NonNullable<SearchResult['scoreParts']>;
  reasons: string[];
}

export class SearchEngine implements ISearchEngine {
  constructor(
    private vectorStore: IVectorStore,
    private embeddingProvider: IEmbeddingProvider | null,
    private headerStore: IHeaderStore,
    private memoryStore: IMemoryStore,
    private stateStore: IStateStore,
    private logger: ILogger,
    private defaultLimit: number = 3,
  ) {}

  async search(query: string, limit?: number, typeFilter?: string): Promise<SearchResult[]> {
    const maxResults = limit || this.defaultLimit;
    const candidateLimit = resolveHybridCandidateLimit(maxResults);
    const normalizedTypeFilter = typeFilter && typeFilter !== 'all' ? typeFilter : undefined;
    const candidates = new Map<string, RankedCandidate>();

    if (normalizedTypeFilter !== 'memory') {
      const exactResults = this.stateStore.searchExact(query, candidateLimit);
      this.addRankedResults(candidates, query, exactResults, 'exact', 4.5);

      const lexicalResults = this.stateStore.searchLexical?.(query, candidateLimit) ?? [];
      this.addRankedResults(candidates, query, lexicalResults, 'lexical', 2.5);

      const regexResults = this.stateStore.searchRegex(escapeRegex(query), candidateLimit);
      this.addRankedResults(candidates, query, regexResults, 'regex', 1.7);
    }

    if (normalizedTypeFilter !== 'memory' && this.embeddingProvider) {
      try {
        const queryVector = await this.embeddingProvider.embed(query);
        const vectorResults = await this.vectorStore.search(
          queryVector,
          normalizedTypeFilter ? Math.max(candidateLimit, maxResults) : candidateLimit,
          normalizedTypeFilter ? { type: normalizedTypeFilter } : undefined,
        );
        this.addRankedResults(candidates, query, vectorResults, 'vector', 1.4);
      } catch (err) {
        this.logger.debug('Vector search skipped:', err instanceof Error ? err.message : String(err));
      }
    }

    if (!normalizedTypeFilter || normalizedTypeFilter === 'memory') {
      try {
        const memories = await this.memoryStore.findSimilar(query, 0.7, candidateLimit);
        for (const mem of memories) {
          this.addRankedResults(candidates, query, [{
            type: 'memory',
            id: mem.id,
            text: mem.text,
            file: mem.file,
          }], 'memory', 1.6);
        }
        const lexicalMemories = await this.memoryStore.list(query);
        for (const mem of lexicalMemories) {
          this.addRankedResults(candidates, query, [{
            type: 'memory',
            id: mem.id,
            text: mem.text,
            file: mem.file,
          }], 'memory', 2.2);
        }
      } catch (err) {
        this.logger.error('Memory search failed:', err);
      }
    }

    return Array.from(candidates.values())
      .map(candidate => this.finalizeCandidate(query, candidate))
      .filter(result => !normalizedTypeFilter || result.type === normalizedTypeFilter)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, maxResults);
  }

  async searchDeep(query: string, limit?: number, typeFilter?: string): Promise<SearchResult[]> {
    const baseResults = await this.search(query, limit, typeFilter);
    return this.enrichResults(baseResults);
  }

  async searchRegexDeep(pattern: string, limit?: number): Promise<SearchResult[]> {
    return this.enrichResults(this.searchRegex(pattern, limit));
  }

  private async enrichResults(baseResults: SearchResult[]): Promise<SearchResult[]> {
    const enrichedResults: SearchResult[] = [];
    for (const result of baseResults) {
      if (result.file && (result.type === 'method' || result.type === 'class')) {
        try {
          const header = await this.headerStore.read(result.file);
          if (header) {
            if (result.type === 'method') {
              const method = header.methods.find(m => m.id === result.id)
                ?? header.methods.find(m => m.name === result.method);
              if (method) {
                enrichedResults.push({
                  ...result,
                  id: method.id,
                  sig: method.sig,
                  loc: method.loc,
                  refs: method.refs,
                  insight: method.insight,
                  class: method.class,
                  namespace: method.namespace ?? header.namespace,
                  decorators: method.decorators,
                  visibility: method.visibility,
                  isAsync: method.isAsync,
                  isStatic: method.isStatic,
                  parameters: method.parameters,
                  returnType: method.returnType,
                  imports: header.imports,
                  exports: header.exports,
                });
                continue;
              }
            } else if (result.type === 'class') {
              const cls = header.classes.find(c => c.id === result.id)
                ?? header.classes.find(c => c.name === result.class);
              if (cls) {
                enrichedResults.push({
                  ...result,
                  id: cls.id,
                  loc: cls.loc,
                  insight: cls.insight,
                  namespace: cls.namespace ?? header.namespace,
                  decorators: cls.decorators,
                  visibility: cls.visibility,
                  extends: cls.extends,
                  implements: cls.implements,
                  imports: header.imports,
                  exports: header.exports,
                });
                continue;
              }
            }
          }
        } catch (err) {
          this.logger.error(`Failed to enrich result for ${result.file}:`, err);
        }
      }
      enrichedResults.push(result);
    }

    return enrichedResults;
  }

  searchExact(query: string, limit?: number): SearchResult[] {
    return this.stateStore.searchExact(query, limit || this.defaultLimit);
  }

  searchRegex(pattern: string, limit?: number): SearchResult[] {
    return this.stateStore.searchRegex(pattern, limit || this.defaultLimit);
  }

  private addRankedResults(
    candidates: Map<string, RankedCandidate>,
    query: string,
    results: SearchResult[],
    signal: SearchSignal,
    weight: number,
  ): void {
    let rank = 0;
    for (const result of results) {
      rank++;
      const key = buildResultKey(result);
      const existing = candidates.get(key);
      const directBoost = lexicalBoostScore(query, result);
      const pathBoost = pathProximityScore(query, result.file);
      const nativeScore = normalizeNativeScore(signal, result.score);
      const rankScore = weight / (60 + rank);
      const baseScore = directBoost + pathBoost + typePriorityScore(result);
      const signalScore = rankScore + baseScore + nativeScore;
      const reasons = describeSignal(signal, directBoost, pathBoost, nativeScore);
      const scoreParts = buildScoreParts(query, signal, directBoost, pathBoost, nativeScore, result);
      const matchedBy = detectMatchedBy(query, result);

      if (existing) {
        const baseDelta = Math.max(0, baseScore - existing.baseScore);
        existing.baseScore += baseDelta;
        existing.score += rankScore + nativeScore + baseDelta;
        existing.signals.add(signal);
        for (const match of matchedBy) existing.matchedBy.add(match);
        mergeScoreParts(existing.scoreParts, scoreParts);
        existing.reasons.push(...reasons);
        existing.result = mergeResults(existing.result, result);
        continue;
      }

      candidates.set(key, {
        result: { ...result },
        score: signalScore,
        baseScore,
        signals: new Set([signal]),
        matchedBy: new Set(matchedBy),
        scoreParts,
        reasons,
      });
    }
  }

  private finalizeCandidate(query: string, candidate: RankedCandidate): SearchResult {
    const signals = Array.from(candidate.signals);
    const matchedBy = Array.from(candidate.matchedBy);
    const scoreParts = roundScoreParts(candidate.scoreParts);
    return {
      ...candidate.result,
      score: Number(candidate.score.toFixed(6)),
      matchedBy: matchedBy.length > 0 ? matchedBy : undefined,
      scoreParts,
      matchReason: buildMatchReason(query, signals, candidate.reasons),
    };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveHybridCandidateLimit(limit: number): number {
  return Math.max(limit * 8, 24);
}

function splitIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[._#:/\\-]+/g, ' ');
}

function lexicalBoostScore(query: string, result: Pick<SearchResult, 'file' | 'method' | 'class' | 'sig' | 'refs' | 'insight' | 'text'>): number {
  const q = query.toLowerCase().trim();
  const compactQuery = compactToken(query);
  const queryTerms = tokenize(query);
  let score = 0;
  const file = result.file?.toLowerCase() ?? '';
  const method = result.method?.toLowerCase() ?? '';
  const cls = result.class?.toLowerCase() ?? '';
  const sig = result.sig?.toLowerCase() ?? '';
  const refs = result.refs?.join(' ').toLowerCase() ?? '';
  const insight = result.insight?.toLowerCase() ?? '';
  const text = result.text?.toLowerCase() ?? '';
  const symbolText = [method, cls, `${cls}.${method}`, `${cls}#${method}`].filter(Boolean).join(' ');
  const allText = [file, symbolText, sig, refs, insight, text].join(' ');
  const allTokens = new Set(tokenize(allText));

  if (method === q || cls === q || `${cls}.${method}` === q || `${cls}#${method}` === q) score += 6;
  if (compactToken(method) === compactQuery || compactToken(cls) === compactQuery) score += 5;
  if (compactToken(`${cls}.${method}`) === compactQuery || compactToken(`${cls}#${method}`) === compactQuery) score += 6;
  if (file.includes(q)) score += 3;
  if (sig.includes(q)) score += 2;
  if (insight.includes(q)) score += 2;
  if (refs.includes(q)) score += 1.5;
  if (text.includes(q)) score += 2;

  if (queryTerms.length > 0) {
    const matchedTerms = queryTerms.filter(term => allTokens.has(term)).length;
    score += (matchedTerms / queryTerms.length) * 2.5;
    if (matchedTerms === queryTerms.length) {
      score += 2;
    }
  }

  for (const token of queryTerms) {
    if (token.length < 2) continue;
    if (tokenize(symbolText).includes(token)) score += 1.5;
    if (file.includes(token) || sig.includes(token) || refs.includes(token) || insight.includes(token) || text.includes(token)) score += 0.5;
  }

  return score;
}

function symbolBoostScore(query: string, result: Pick<SearchResult, 'method' | 'class'>): number {
  const q = query.toLowerCase();
  const compactQuery = compactToken(query);
  const method = result.method?.toLowerCase() ?? '';
  const cls = result.class?.toLowerCase() ?? '';
  let score = 0;

  if (method === q || cls === q || `${cls}.${method}` === q || `${cls}#${method}` === q) {
    score += 6;
  }

  if (compactToken(method) === compactQuery || compactToken(cls) === compactQuery) {
    score += 4;
  }

  if (compactToken(`${cls}.${method}`) === compactQuery || compactToken(`${cls}#${method}`) === compactQuery) {
    score += 5;
  }

  for (const token of tokenize(query)) {
    if (tokenize(method).includes(token) || tokenize(cls).includes(token)) {
      score += 1.5;
    }
  }

  return score;
}

function pathProximityScore(query: string, file: string | undefined): number {
  if (!file) {
    return 0;
  }

  const queryParts = tokenize(query);
  if (queryParts.length === 0) {
    return 0;
  }

  const fileParts = tokenize(file);
  const matches = queryParts.filter(part => fileParts.includes(part)).length;
  const directoryMatches = queryParts.filter(part => file.toLowerCase().includes(`/${part}/`) || file.toLowerCase().includes(`\\${part}\\`)).length;
  return matches * 0.35 + directoryMatches * 0.35;
}

function tokenize(value: string): string[] {
  return splitIdentifier(value)
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map(token => token.trim())
    .filter(token => token.length > 1 && !isSearchStopWord(token));
}

function compactToken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
}

function normalizeNativeScore(signal: SearchSignal, score: number | undefined): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  if (signal === 'vector') {
    return 1 / (1 + Math.max(0, score as number));
  }
  if (signal === 'lexical') {
    return Math.max(0, score as number);
  }
  return Math.max(0, Math.min(score as number, 1));
}

function typePriorityScore(result: SearchResult): number {
  if (result.type === 'method') return 0.3;
  if (result.type === 'class') return 0.2;
  return 0;
}

function buildScoreParts(
  query: string,
  signal: SearchSignal,
  directBoost: number,
  pathBoost: number,
  nativeScore: number,
  result: SearchResult,
): NonNullable<SearchResult['scoreParts']> {
  const symbol = symbolBoostScore(query, result);
  return {
    lexical: signal === 'lexical' || signal === 'exact' || signal === 'regex' ? directBoost + nativeScore : directBoost,
    vector: signal === 'vector' ? nativeScore : 0,
    memory: signal === 'memory' ? directBoost + nativeScore : 0,
    symbol,
    path: pathBoost,
  };
}

function mergeScoreParts(target: NonNullable<SearchResult['scoreParts']>, source: NonNullable<SearchResult['scoreParts']>): void {
  target.lexical = Math.max(target.lexical ?? 0, source.lexical ?? 0);
  target.vector = Math.max(target.vector ?? 0, source.vector ?? 0);
  target.memory = Math.max(target.memory ?? 0, source.memory ?? 0);
  target.symbol = Math.max(target.symbol ?? 0, source.symbol ?? 0);
  target.path = Math.max(target.path ?? 0, source.path ?? 0);
}

function roundScoreParts(parts: NonNullable<SearchResult['scoreParts']>): NonNullable<SearchResult['scoreParts']> {
  return Object.fromEntries(
    Object.entries(parts)
      .filter(([, value]) => typeof value === 'number' && value > 0)
      .map(([key, value]) => [key, Number(value.toFixed(6))]),
  ) as NonNullable<SearchResult['scoreParts']>;
}

function detectMatchedBy(query: string, result: SearchResult): NonNullable<SearchResult['matchedBy']> {
  const q = query.toLowerCase();
  const compactQuery = compactToken(query);
  const tokens = tokenize(query);
  const matches = new Set<NonNullable<SearchResult['matchedBy']>[number]>();
  const hasMatch = (value: string | undefined): boolean => {
    const lower = value?.toLowerCase() ?? '';
    const compact = compactToken(value ?? '');
    const valueTokens = new Set(tokenize(value ?? ''));
    return lower.includes(q)
      || (compactQuery.length > 1 && compact.includes(compactQuery))
      || tokens.some(token => valueTokens.has(token) || lower.includes(token));
  };

  if (hasMatch(result.method)) matches.add('name');
  if (hasMatch(result.class)) matches.add('class');
  if (hasMatch(result.sig)) matches.add('signature');
  if (hasMatch(result.file)) matches.add('file path');
  if (result.type === 'memory') matches.add('memory');
  if (result.refs?.some(ref => hasMatch(ref))) matches.add('refs');
  if (hasMatch(result.insight)) matches.add('insight');

  return Array.from(matches);
}

function buildResultKey(result: SearchResult): string {
  if (result.type === 'memory') {
    return `memory:${result.id ?? result.text ?? ''}`;
  }
  return `${result.type}:${result.id ?? `${result.file ?? ''}:${result.class ?? ''}:${result.method ?? ''}:${result.loc ?? ''}`}`;
}

function describeSignal(signal: SearchSignal, directBoost: number, pathBoost: number, nativeScore: number): string[] {
  const reasons: string[] = [signal];
  if (directBoost > 0) {
    reasons.push('exact/name/text boost');
  }
  if (pathBoost > 0) {
    reasons.push('path/module proximity');
  }
  if (nativeScore > 0 && (signal === 'vector' || signal === 'lexical')) {
    reasons.push(`${signal} score`);
  }
  return reasons;
}

function buildMatchReason(_query: string, signals: string[], reasons: string[]): string {
  return `Signals=${signals.join('+')}; evidence=${Array.from(new Set(reasons)).join(', ')}.`;
}

function mergeResults(primary: SearchResult, next: SearchResult): SearchResult {
  return {
    ...primary,
    id: primary.id ?? next.id,
    file: primary.file ?? next.file,
    method: primary.method ?? next.method,
    class: primary.class ?? next.class,
    loc: primary.loc ?? next.loc,
    sig: primary.sig ?? next.sig,
    refs: primary.refs ?? next.refs,
    insight: primary.insight ?? next.insight,
    text: primary.text ?? next.text,
    generationId: primary.generationId ?? next.generationId,
    namespace: primary.namespace ?? next.namespace,
    decorators: primary.decorators ?? next.decorators,
    visibility: primary.visibility ?? next.visibility,
    isAsync: primary.isAsync ?? next.isAsync,
    isStatic: primary.isStatic ?? next.isStatic,
    parameters: primary.parameters ?? next.parameters,
    returnType: primary.returnType ?? next.returnType,
    extends: primary.extends ?? next.extends,
    implements: primary.implements ?? next.implements,
    imports: primary.imports ?? next.imports,
    exports: primary.exports ?? next.exports,
  };
}
