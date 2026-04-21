import { ISearchEngine } from '../interfaces/ISearchEngine';
import { IVectorStore } from '../interfaces/IVectorStore';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { IStateStore } from '../interfaces/IStateStore';
import { ILogger } from '../interfaces/ILogger';
import { SearchResult } from '../interfaces/types';

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
    const results: SearchResult[] = [];
    const maxResults = limit || this.defaultLimit;
    const normalizedTypeFilter = typeFilter && typeFilter !== 'all' ? typeFilter : undefined;

    if (normalizedTypeFilter !== 'memory' && this.embeddingProvider) {
      try {
        const queryVector = await this.embeddingProvider.embed(query);
        const vectorResults = await this.vectorStore.search(
          queryVector,
          normalizedTypeFilter ? Math.max(maxResults * 3, maxResults) : Math.max(maxResults * 2, maxResults),
          normalizedTypeFilter ? { type: normalizedTypeFilter } : undefined,
        );
        results.push(...vectorResults);
      } catch (err) {
        this.logger.error('Vector search failed:', err);
      }
    }

    if (!normalizedTypeFilter || normalizedTypeFilter === 'memory') {
      try {
        const memories = await this.memoryStore.findSimilar(query, 0.7, maxResults);
        for (const mem of memories) {
          results.push({
            type: 'memory',
            id: mem.id,
            text: mem.text,
          });
        }
      } catch (err) {
        this.logger.error('Memory search failed:', err);
      }
    }

    const filtered = normalizedTypeFilter
      ? results.filter(result => result.type === normalizedTypeFilter)
      : results;
    return this.dedupeResults(filtered).slice(0, maxResults);
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

  private dedupeResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];

    for (const result of results) {
      const key = result.type === 'memory'
        ? `memory:${result.id ?? result.text ?? ''}`
        : `${result.type}:${result.id ?? `${result.file ?? ''}:${result.method ?? result.class ?? ''}:${result.loc ?? ''}`}`;

      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(result);
    }

    return deduped;
  }
}
