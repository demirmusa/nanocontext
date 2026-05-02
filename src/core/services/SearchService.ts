import { IConfigManager } from '../interfaces/IConfigManager';
import { ILLMProvider } from '../interfaces/ILLMProvider';
import { ILogger } from '../interfaces/ILogger';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { ISearchEngine } from '../interfaces/ISearchEngine';
import { SearchResult, SmartSearchCandidate } from '../interfaces/types';

type SearchFallback = NonNullable<SearchResult['fallback']>;
type SearchConfig = {
  limit: number;
  smartSearchEnabled: boolean;
  smartSearchCandidateMultiplier: number;
};
type VectorRouteResult = {
  results: SearchResult[];
  fallbackPath: string[];
  rerankUsed?: boolean;
  smartSearch?: NonNullable<NonNullable<SearchResult['searchTelemetry']>['smartSearch']>;
};

export type SearchMode = 'exact' | 'regex' | 'vector';
export type SearchTypeFilter = 'method' | 'class' | 'memory' | 'all';

export interface SearchRequest {
  mode: SearchMode;
  query: string;
  deep?: boolean;
  limit?: number;
  typeFilter?: SearchTypeFilter;
}

export class SearchService {
  private resultCache = new Map<string, SearchResult[]>();
  private emptyQueryCounts = new Map<string, number>();

  constructor(
    private searchEngine: ISearchEngine,
    private configManager: IConfigManager,
    private llmProvider: ILLMProvider | null = null,
    private logger?: ILogger,
    private memoryStore?: IMemoryStore,
  ) {}

  async execute(request: SearchRequest): Promise<SearchResult[]> {
    const searchConfig = await this.resolveSearchConfig(request.limit);
    const limit = searchConfig.limit;
    const intent = classifyIntent(request.query);
    const cacheKey = this.buildCacheKey(request, searchConfig);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return cached.map(result => ({ ...result }));
    }

    let results: SearchResult[];
    if (request.mode === 'regex') {
      if (request.deep) {
        results = await this.finalizeResults(this.attachSuggestedNext(request.mode, await this.searchEngine.searchRegexDeep(request.query, limit)), request.query, intent, ['regex']);
        this.storeCachedResults(cacheKey, results);
        return results;
      }
      results = await this.finalizeResults(this.attachSuggestedNext(request.mode, this.searchEngine.searchRegex(request.query, limit)), request.query, intent, ['regex']);
      this.storeCachedResults(cacheKey, results);
      return results;
    }

    if (request.mode === 'vector') {
      results = await this.executeVectorRoute(request, searchConfig, intent, ['vector'], 'vector');
      this.storeCachedResults(cacheKey, results);
      return results;
    }

    if (intent === 'semantic' && request.mode === 'exact') {
      const semanticResults = await this.executeVectorRoute(
        { ...request, mode: 'vector' },
        searchConfig,
        intent,
        ['intent:semantic', 'vector'],
        'vector',
      );
      this.storeCachedResults(cacheKey, semanticResults);
      return semanticResults;
    }

    const exactResults = this.searchEngine.searchExact(request.query, limit);
    if (exactResults.length > 0) {
      results = await this.finalizeResults(this.attachSuggestedNext(request.mode, exactResults), request.query, intent, ['exact']);
      this.storeCachedResults(cacheKey, results);
      return results;
    }

    const normalizedQuery = normalizeSearchQuery(request.query);
    if (normalizedQuery && normalizedQuery !== request.query) {
      const normalizedResults = this.searchEngine.searchExact(normalizedQuery, limit);
      if (normalizedResults.length > 0) {
        results = await this.finalizeResults(
          this.markFallbackResults(
            this.attachSuggestedNext(request.mode, normalizedResults),
            request.query,
            'normalized-exact',
            'exact',
            `no exact matches; retried with normalized query "${normalizedQuery}"`,
          ),
          request.query,
          intent,
          ['exact', 'normalized-exact'],
        );
        this.storeCachedResults(cacheKey, results);
        return results;
      }
    }

    const emptyKey = this.buildEmptyQueryKey(request, searchConfig);
    const emptyCount = (this.emptyQueryCounts.get(emptyKey) ?? 0) + 1;
    this.emptyQueryCounts.set(emptyKey, emptyCount);

    const fallbackQuery = normalizedQuery || request.query;
    const semanticRoute = await this.collectVectorResults(
      { ...request, mode: 'vector', query: fallbackQuery },
      searchConfig,
      intent,
      ['exact', 'semantic-fallback'],
    );
    if (semanticRoute.results.length > 0) {
      results = await this.finalizeResults(
        this.markFallbackResults(
          this.attachSuggestedNext('vector', semanticRoute.results),
          request.query,
          'semantic',
          'exact',
          `no exact matches${emptyCount > 1 ? ` after ${emptyCount} attempts` : ''}`,
        ),
        request.query,
        intent,
        semanticRoute.fallbackPath,
        semanticRoute.rerankUsed,
        semanticRoute.smartSearch,
      );
      this.storeCachedResults(cacheKey, results);
      return results;
    }

    return [];
  }

  private async executeVectorRoute(
    request: SearchRequest,
    searchConfig: SearchConfig,
    intent: SearchResult['searchIntent'],
    fallbackPath: string[],
    suggestionMode: SearchMode,
  ): Promise<SearchResult[]> {
    const route = await this.collectVectorResults(request, searchConfig, intent, fallbackPath);
    return this.finalizeResults(
      this.attachSuggestedNext(suggestionMode, route.results),
      request.query,
      intent,
      route.fallbackPath,
      route.rerankUsed,
      route.smartSearch,
    );
  }

  private async collectVectorResults(
    request: SearchRequest,
    searchConfig: SearchConfig,
    intent: SearchResult['searchIntent'],
    fallbackPath: string[],
  ): Promise<VectorRouteResult> {
    const { limit } = searchConfig;

    if (!searchConfig.smartSearchEnabled) {
      const results = await this.runVectorSearch(request, limit);
      return {
        results,
        fallbackPath,
        smartSearch: {
          enabled: false,
          requestedLimit: limit,
          returnedCount: results.length,
          status: 'disabled',
          reason: 'smart search disabled in project config',
        },
      };
    }

    if (!this.llmProvider) {
      this.logger?.warn('Smart search is enabled but no LLM provider is configured; falling back to hybrid vector ordering.');
      const results = await this.runVectorSearch(request, limit);
      return {
        results,
        fallbackPath: [...fallbackPath, 'rerank-unavailable'],
        rerankUsed: false,
        smartSearch: {
          enabled: true,
          requestedLimit: limit,
          returnedCount: results.length,
          status: 'unavailable',
          reason: 'LLM provider is not configured',
        },
      };
    }

    const candidateLimit = this.resolveCandidateLimit(limit, searchConfig.smartSearchCandidateMultiplier, intent);
    const candidates = await this.runVectorSearch(request, candidateLimit);
    const candidateSummaries = candidates.map((candidate, index) => this.summarizeSmartSearchCandidate(candidate, index));

    if (candidates.length <= limit) {
      return {
        results: candidates,
        fallbackPath: [...fallbackPath, 'rerank-skipped'],
        rerankUsed: false,
        smartSearch: {
          enabled: true,
          requestedLimit: limit,
          candidateLimit,
          candidateCount: candidates.length,
          returnedCount: candidates.length,
          status: 'skipped',
          reason: `candidate count ${candidates.length} is within requested limit ${limit}`,
          candidates: candidateSummaries,
        },
      };
    }

    const mappedCandidates = candidates.map((candidate, index) => ({
      candidateId: candidate.id || `${candidate.type}:${index}`,
      result: candidate,
    }));

    try {
      const selection = await this.llmProvider.selectRelevantSearchResults(
        request.query,
        mappedCandidates.map(({ candidateId, result }) => this.toSmartSearchCandidate(candidateId, result)),
        limit,
      );
      const selectedResults = this.applySmartSearchSelection(mappedCandidates, selection.selectedIds, limit);
      if (selectedResults.length > 0) {
        return {
          results: selectedResults,
          fallbackPath: [...fallbackPath, 'rerank'],
          rerankUsed: true,
          smartSearch: {
            enabled: true,
            requestedLimit: limit,
            candidateLimit,
            candidateCount: candidates.length,
            selectedCount: selectedResults.length,
            selectedIds: selection.selectedIds,
            rawResponse: selection.rawResponse,
            returnedCount: selectedResults.length,
            status: 'selected',
            candidates: candidateSummaries,
          },
        };
      }
    } catch (error) {
      this.logger?.warn('Smart search rerank failed, falling back to vector ordering:', error);
    }

    return {
      results: candidates.slice(0, limit),
      fallbackPath: [...fallbackPath, 'rerank-fallback'],
      rerankUsed: false,
      smartSearch: {
        enabled: true,
        requestedLimit: limit,
        candidateLimit,
        candidateCount: candidates.length,
        selectedCount: 0,
        selectedIds: [],
        returnedCount: Math.min(candidates.length, limit),
        status: 'fallback',
        reason: 'LLM did not return valid selected candidate ids',
        candidates: candidateSummaries,
      },
    };
  }

  private async runVectorSearch(request: SearchRequest, limit: number): Promise<SearchResult[]> {
    return request.deep
      ? this.searchEngine.searchDeep(request.query, limit, request.typeFilter)
      : this.searchEngine.search(request.query, limit, request.typeFilter);
  }

  private async resolveSearchConfig(requestedLimit?: number): Promise<SearchConfig> {
    const config = await this.configManager.loadProjectConfig();
    const fallbackLimit = config.search.defaultLimit;
    const maxLimit = Math.max(1, config.search.maxLimit);
    const rawLimit = requestedLimit && Number.isFinite(requestedLimit)
      ? Math.floor(requestedLimit)
      : fallbackLimit;

    return {
      limit: Math.max(1, Math.min(rawLimit, maxLimit)),
      smartSearchEnabled: config.search.smartSearchEnabled ?? false,
      smartSearchCandidateMultiplier: normalizeCandidateMultiplier(config.search.smartSearchCandidateMultiplier),
    };
  }

  private toSmartSearchCandidate(candidateId: string, result: SearchResult): SmartSearchCandidate {
    return {
      id: candidateId,
      type: result.type,
      file: result.file,
      method: result.method,
      class: result.class,
      loc: result.loc,
      sig: result.sig,
      refs: result.refs,
      insight: result.insight,
      text: result.type === 'memory' ? result.text : undefined,
      score: result.score,
      matchedBy: result.matchedBy,
      scoreParts: result.scoreParts,
      matchReason: result.matchReason,
    };
  }

  private summarizeSmartSearchCandidate(
    result: SearchResult,
    index: number,
  ): NonNullable<NonNullable<NonNullable<SearchResult['searchTelemetry']>['smartSearch']>['candidates']>[number] {
    const id = result.id || `${result.type}:${index}`;
    const label = result.type === 'memory'
      ? `[memory] ${result.text ?? id}`
      : `${result.file ?? 'unknown'} ${result.method ?? result.class ?? ''}${result.loc ? `[${result.loc}]` : ''}`.trim();
    return {
      id,
      label,
      score: result.score,
      matchedBy: result.matchedBy,
    };
  }

  private applySmartSearchSelection(
    candidates: Array<{ candidateId: string; result: SearchResult }>,
    selectedIds: string[],
    limit: number,
  ): SearchResult[] {
    const candidateMap = new Map(candidates.map(candidate => [candidate.candidateId, candidate.result]));
    const selectedResults: SearchResult[] = [];

    for (const candidateId of selectedIds) {
      const result = candidateMap.get(candidateId);
      if (result) {
        selectedResults.push(result);
      }
      if (selectedResults.length >= limit) {
        break;
      }
    }

    return selectedResults;
  }

  private attachSuggestedNext(mode: SearchMode, results: SearchResult[]): SearchResult[] {
    return results.map(result => {
      const suggestion = this.buildSuggestedNext(mode, result);
      return suggestion ? { ...result, ...suggestion } : result;
    });
  }

  private buildSuggestedNext(
    mode: SearchMode,
    result: SearchResult,
  ): Pick<SearchResult, 'suggestedNext' | 'suggestedNextReason' | 'suggestedNextConfidence'> | null {
    if (result.type === 'memory') {
      return null;
    }

    if (result.file && result.loc) {
      return {
        suggestedNext: `nc get ${result.file}[${this.expandLoc(result.loc)}]`,
        suggestedNextReason: `${result.type} match with a precise location`,
        suggestedNextConfidence: mode === 'exact' ? 0.95 : mode === 'regex' ? 0.85 : 0.75,
      };
    }

    if (result.file) {
      return {
        suggestedNext: `nc get ${result.file}`,
        suggestedNextReason: 'open the file summary before narrowing to a raw range',
        suggestedNextConfidence: 0.5,
      };
    }

    return null;
  }

  private expandLoc(loc: string, padding: number = 8): string {
    const [start, end] = loc.split('-').map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return loc;
    }

    return `${Math.max(1, start - padding)}-${end + padding}`;
  }

  private buildCacheKey(request: SearchRequest, searchConfig: SearchConfig): string {
    return [
      request.mode,
      request.deep ? 'deep' : 'shallow',
      request.typeFilter ?? 'all',
      searchConfig.limit,
      searchConfig.smartSearchEnabled ? 'smart' : 'plain',
      searchConfig.smartSearchCandidateMultiplier,
      this.llmProvider ? 'llm' : 'no-llm',
      classifyIntent(request.query),
      normalizeSearchQuery(request.query).toLowerCase(),
    ].join('::');
  }

  private buildEmptyQueryKey(request: SearchRequest, searchConfig: SearchConfig): string {
    return this.buildCacheKey(request, searchConfig);
  }

  private markFallbackResults(
    results: SearchResult[],
    originalQuery: string,
    mode: SearchFallback['mode'],
    from: SearchFallback['from'],
    reason: string,
  ): SearchResult[] {
    return results.map(result => ({
      ...result,
      matchReason: `Fallback ${mode} from ${from}; ${reason}.`,
      fallback: {
        originalQuery,
        mode,
        from,
        reason,
      },
      suggestedNextConfidence: downgradeConfidence(result.suggestedNextConfidence, mode),
    }));
  }

  private storeCachedResults(cacheKey: string, results: SearchResult[]): void {
    this.resultCache.set(cacheKey, results.map(result => ({ ...result })));
  }

  private resolveCandidateLimit(limit: number, candidateMultiplier: number, intent: SearchResult['searchIntent']): number {
    if (intent === 'exact-symbol' || intent === 'dependency') {
      return Math.max(limit, limit * 2);
    }
    if (intent === 'trace') {
      return Math.max(limit, limit * 4);
    }
    return Math.max(limit, limit * candidateMultiplier);
  }

  private async finalizeResults(
    results: SearchResult[],
    query: string,
    intent: SearchResult['searchIntent'],
    fallbackPath: string[],
    rerankUsed?: boolean,
    smartSearch?: NonNullable<NonNullable<SearchResult['searchTelemetry']>['smartSearch']>,
  ): Promise<SearchResult[]> {
    const clustered = await this.attachMemoryHints(clusterResults(results));
    const topConfidence = clustered[0]?.suggestedNextConfidence;
    const finalResults = clustered.map(result => ({
      ...attachExplainFields(result, query, fallbackPath),
      searchIntent: intent,
      searchTelemetry: {
        route: fallbackPath[0],
        fallbackPath,
        rerankUsed,
        topConfidence,
        smartSearch,
      },
    }));
    this.logger?.debug(`[search] q="${query}" path="${fallbackPath.join(' > ')}" intent=${intent} count=${finalResults.length} rerank=${rerankUsed === true ? 'yes' : rerankUsed === false ? 'no' : 'n/a'} topConfidence=${topConfidence ?? 'n/a'}`);
    return finalResults;
  }

  private async attachMemoryHints(results: SearchResult[]): Promise<SearchResult[]> {
    if (!this.memoryStore) {
      return results;
    }

    return Promise.all(results.map(async (result) => {
      const symbolId = buildSearchResultSymbolId(result);
      if (symbolId) {
        const symbolMemories = await this.memoryStore?.listBySymbol(symbolId);
        if (symbolMemories && symbolMemories.length > 0) {
          return { ...result, memoryHint: symbolMemories[0].text };
        }
      }
      if (result.file) {
        const fileMemories = await this.memoryStore?.listByFile(result.file);
        if (fileMemories && fileMemories.length > 0) {
          return { ...result, memoryHint: fileMemories[0].text };
        }
      }
      return result;
    }));
  }
}

function normalizeSearchQuery(query: string): string {
  return query
    .replace(/<[^>]+>/g, '')
    .replace(/[()[\]{};,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyIntent(query: string): SearchResult['searchIntent'] {
  const trimmed = query.trim();
  if (!trimmed) {
    return 'mixed';
  }
  if (/\b(trace|flow|call chain|execution path|walk)\b/i.test(trimmed)) {
    return 'trace';
  }
  if (/\b(refs|callers|depends on|dependency)\b/i.test(trimmed)) {
    return 'dependency';
  }
  if (/^[A-Za-z_][\w.<>#-]*$/.test(trimmed) && /[A-Z_#.]/.test(trimmed)) {
    return 'exact-symbol';
  }
  if (/\s/.test(trimmed) && /^[\p{L}\p{N}\s._/#-]+$/u.test(trimmed)) {
    return 'semantic';
  }
  return 'mixed';
}

function clusterResults(results: SearchResult[]): SearchResult[] {
  const grouped = new Map<string, SearchResult[]>();
  const memories: SearchResult[] = [];

  for (const result of results) {
    if (result.type === 'memory') {
      memories.push(result);
      continue;
    }
    const key = `${result.file ?? ''}:${result.class ?? result.method ?? ''}`;
    const list = grouped.get(key) ?? [];
    list.push(result);
    grouped.set(key, list);
  }

  const clustered: SearchResult[] = [];
  for (const list of grouped.values()) {
    list.sort((a, b) =>
      ((b.suggestedNextConfidence ?? 0) - (a.suggestedNextConfidence ?? 0))
      || ((b.score ?? 0) - (a.score ?? 0))
    );
    const [primary, ...rest] = list;
    if (!primary) continue;
    clustered.push({
      ...primary,
      related: rest.slice(0, 3).map(item => ({
        file: item.file,
        method: item.method,
        class: item.class,
        loc: item.loc,
        sig: item.sig,
      })),
    });
  }

  return [...clustered, ...memories];
}

function normalizeCandidateMultiplier(value?: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.floor(value as number));
}

function downgradeConfidence(value: number | undefined, mode: SearchFallback['mode']): number | undefined {
  if (value === undefined) {
    return value;
  }
  const penalty = mode === 'normalized-exact' ? 0.08 : 0.2;
  return Math.max(0.1, Number((value - penalty).toFixed(2)));
}

function buildSearchResultSymbolId(result: SearchResult): string | undefined {
  if (!result.file || !result.loc || (result.type !== 'method' && result.type !== 'class')) {
    return undefined;
  }
  const display = result.type === 'method'
    ? (result.class ? `${result.class}#${result.method}` : result.method)
    : result.class;
  return `${result.file}:${result.loc}:${result.type}:${display ?? ''}`;
}

function attachExplainFields(result: SearchResult, query: string, route: string[]): SearchResult {
  const matchedBy = result.matchedBy ?? inferMatchedBy(query, result);
  const scoreParts = result.scoreParts ?? inferScoreParts(query, route, result);
  return {
    ...result,
    matchedBy: matchedBy.length > 0 ? matchedBy : undefined,
    scoreParts,
    matchReason: result.matchReason ?? buildRouteMatchReason(query, route, matchedBy),
  };
}

function inferMatchedBy(query: string, result: SearchResult): NonNullable<SearchResult['matchedBy']> {
  const q = query.toLowerCase();
  const tokens = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const matches = new Set<NonNullable<SearchResult['matchedBy']>[number]>();
  const hasMatch = (value: string | undefined): boolean => {
    const lower = value?.toLowerCase() ?? '';
    return lower.includes(q) || tokens.some(token => lower.includes(token));
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

function inferScoreParts(query: string, route: string[], result: SearchResult): NonNullable<SearchResult['scoreParts']> {
  const matchedBy = inferMatchedBy(query, result);
  const routeSet = new Set(route);
  const lexical = matchedBy.length > 0 && (routeSet.has('exact') || routeSet.has('regex') || routeSet.has('normalized-exact'))
    ? 1
    : undefined;
  return {
    lexical,
    vector: routeSet.has('vector') || routeSet.has('semantic-fallback') ? result.score : undefined,
    memory: result.type === 'memory' ? result.score ?? 1 : undefined,
    symbol: matchedBy.some(match => match === 'name' || match === 'class') ? 1 : undefined,
    path: matchedBy.includes('file path') ? 1 : undefined,
  };
}

function buildRouteMatchReason(_query: string, route: string[], matchedBy: NonNullable<SearchResult['matchedBy']>): string {
  const routeText = route.join(' > ');
  const matchText = matchedBy.length > 0 ? matchedBy.join(', ') : 'ranked candidate';
  return `Route ${routeText}; matched by ${matchText}.`;
}
