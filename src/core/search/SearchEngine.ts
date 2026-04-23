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
    const lexicalResults = normalizedTypeFilter === 'memory'
      ? []
      : [
        ...this.stateStore.searchExact(query, maxResults),
        ...this.stateStore.searchRegex(escapeRegex(query), maxResults),
      ].map(result => ({
        ...result,
        score: lexicalBoostScore(query, result),
      }));

    results.push(...lexicalResults);

    if (normalizedTypeFilter !== 'memory' && this.embeddingProvider) {
      try {
        const queryVector = await this.embeddingProvider.embed(query);
        const vectorResults = await this.vectorStore.search(
          queryVector,
          normalizedTypeFilter ? Math.max(maxResults * 3, maxResults) : Math.max(maxResults * 2, maxResults),
          normalizedTypeFilter ? { type: normalizedTypeFilter } : undefined,
        );
        results.push(...vectorResults.map(result => ({
          ...result,
          score: lexicalBoostScore(query, result) + (typeof result.score === 'number' ? Math.max(0, 1 - result.score) : 0),
        })));
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
            file: mem.file,
            score: lexicalBoostScore(query, { text: mem.text, file: mem.file }),
          });
        }
        const lexicalMemories = await this.memoryStore.list(query);
        for (const mem of lexicalMemories) {
          results.push({
            type: 'memory',
            id: mem.id,
            text: mem.text,
            file: mem.file,
            score: lexicalBoostScore(query, { text: mem.text, file: mem.file }) + 1,
          });
        }
      } catch (err) {
        this.logger.error('Memory search failed:', err);
      }
    }

    const filtered = normalizedTypeFilter
      ? results.filter(result => result.type === normalizedTypeFilter)
      : results;
    return this.dedupeResults(filtered)
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lexicalBoostScore(query: string, result: Pick<SearchResult, 'file' | 'method' | 'class' | 'sig' | 'text'>): number {
  const q = query.toLowerCase();
  let score = 0;
  const file = result.file?.toLowerCase() ?? '';
  const method = result.method?.toLowerCase() ?? '';
  const cls = result.class?.toLowerCase() ?? '';
  const sig = result.sig?.toLowerCase() ?? '';
  const text = result.text?.toLowerCase() ?? '';

  if (method === q || cls === q || `${cls}.${method}` === q) score += 5;
  if (file.includes(q)) score += 3;
  if (sig.includes(q)) score += 2;
  if (text.includes(q)) score += 2;

  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (method.includes(token) || cls.includes(token)) score += 1.5;
    if (file.includes(token) || sig.includes(token) || text.includes(token)) score += 0.5;
  }

  return score;
}
