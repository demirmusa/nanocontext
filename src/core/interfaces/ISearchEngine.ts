import { SearchResult } from './types';

export interface ISearchEngine {
  search(query: string, limit?: number, typeFilter?: string): Promise<SearchResult[]>;
  searchDeep(query: string, limit?: number, typeFilter?: string): Promise<SearchResult[]>;
  searchExact(query: string, limit?: number): SearchResult[];
  searchRegex(pattern: string, limit?: number): SearchResult[];
  searchRegexDeep(pattern: string, limit?: number): Promise<SearchResult[]>;
}
