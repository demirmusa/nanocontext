import { SearchMode, SearchRequest } from '../../core/services/SearchService';

export interface SearchCommandOptions {
  deep?: boolean;
  exact?: boolean;
  vector?: boolean;
  regex?: boolean;
  limit?: string;
  explain?: boolean;
}

export function buildSearchRequest(query: string, options: SearchCommandOptions): SearchRequest {
  return {
    mode: resolveSearchMode(options),
    query,
    limit: parseInt(options.limit || '3', 10),
    deep: options.deep,
    typeFilter: options.vector ? 'all' : undefined,
  };
}

function resolveSearchMode(options: Pick<SearchCommandOptions, 'vector' | 'regex'>): SearchMode {
  if (options.regex) return 'regex';
  if (options.vector) return 'vector';
  return 'exact';
}
