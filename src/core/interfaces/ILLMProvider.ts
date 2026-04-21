import { LLMConfig, SmartSearchCandidate } from './types';

export interface MethodInsight {
  methodId: string;
  methodName: string;
  insight: string;
}

export interface FileInsightResult {
  insights: MethodInsight[];
  rawResponse: string;
}

export interface SmartSearchSelectionResult {
  selectedIds: string[];
  rawResponse: string;
}

export interface ILLMProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult>;
  selectRelevantSearchResults(
    query: string,
    candidates: SmartSearchCandidate[],
    limit: number,
  ): Promise<SmartSearchSelectionResult>;
}

export interface ILLMProviderFactory {
  create(config: LLMConfig): ILLMProvider;
  getAvailableProviders(): string[];
}
