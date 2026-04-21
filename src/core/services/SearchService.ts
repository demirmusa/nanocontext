import { IConfigManager } from '../interfaces/IConfigManager';
import { ILLMProvider } from '../interfaces/ILLMProvider';
import { ILogger } from '../interfaces/ILogger';
import { ISearchEngine } from '../interfaces/ISearchEngine';
import { SearchResult, SmartSearchCandidate } from '../interfaces/types';

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
  constructor(
    private searchEngine: ISearchEngine,
    private configManager: IConfigManager,
    private llmProvider: ILLMProvider | null = null,
    private logger?: ILogger,
  ) {}

  async execute(request: SearchRequest): Promise<SearchResult[]> {
    const searchConfig = await this.resolveSearchConfig(request.limit);
    const limit = searchConfig.limit;

    if (request.mode === 'regex') {
      if (request.deep) {
        return this.searchEngine.searchRegexDeep(request.query, limit);
      }
      return this.searchEngine.searchRegex(request.query, limit);
    }

    if (request.mode === 'vector') {
      if (searchConfig.smartSearchEnabled) {
        return this.executeSmartVectorSearch(request, limit, searchConfig.smartSearchCandidateMultiplier);
      }
      if (request.deep) {
        return this.searchEngine.searchDeep(request.query, limit, request.typeFilter);
      }
      return this.searchEngine.search(request.query, limit, request.typeFilter);
    }

    return this.searchEngine.searchExact(request.query, limit);
  }

  private async executeSmartVectorSearch(
    request: SearchRequest,
    limit: number,
    candidateMultiplier: number,
  ): Promise<SearchResult[]> {
    if (!this.llmProvider) {
      throw new Error('Smart search requires a configured LLM provider. Re-run `nc init` and enable an LLM provider.');
    }

    const candidateLimit = Math.max(limit, limit * candidateMultiplier);
    const candidates = request.deep
      ? await this.searchEngine.searchDeep(request.query, candidateLimit, request.typeFilter)
      : await this.searchEngine.search(request.query, candidateLimit, request.typeFilter);

    if (candidates.length <= limit) {
      return candidates;
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
        return selectedResults;
      }
    } catch (error) {
      this.logger?.warn('Smart search rerank failed, falling back to vector ordering:', error);
    }

    return candidates.slice(0, limit);
  }

  private async resolveSearchConfig(requestedLimit?: number): Promise<{
    limit: number;
    smartSearchEnabled: boolean;
    smartSearchCandidateMultiplier: number;
  }> {
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
      text: result.text,
      score: result.score,
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
}

function normalizeCandidateMultiplier(value?: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.floor(value as number));
}
