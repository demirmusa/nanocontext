// HeaderJson schema
export interface HeaderJson {
  file: string;
  lang: string;
  checksum: string;
  generationId?: string;
  namespace?: string;
  classes: ClassInfo[];
  methods: MethodInfo[];
  imports: string[];
  exports: string[];
}

export interface ClassInfo {
  id: string;
  name: string;
  loc: string; // "80-150"
  namespace?: string;
  extends?: string;
  implements?: string[];
  decorators?: string[];
  visibility?: string;
  insight?: string;
}

export interface MethodInfo {
  id: string;
  name: string;
  class?: string;
  loc: string;
  sig: string;
  refs: string[];
  decorators?: string[];
  namespace?: string;
  visibility?: string;
  isAsync?: boolean;
  isStatic?: boolean;
  parameters?: string[];
  returnType?: string;
  insight?: string;
}

export interface SymbolIndexMetadata {
  namespace?: string;
  imports?: string[];
  exports?: string[];
  decorators?: string[];
  visibility?: string;
  isAsync?: boolean;
  isStatic?: boolean;
  parameters?: string[];
  returnType?: string;
  extends?: string;
  implements?: string[];
}

export interface VectorRecord {
  id: string;
  vector: number[];
  type: 'method' | 'class' | 'memory';
  file: string;
  method?: string;
  class?: string;
  loc?: string;
  sig?: string;
  refs?: string[];
  insight?: string;
  lang?: string;
  text?: string; // for memory type
  generationId?: string;
}

export interface ScanManifestFile {
  file: string;
  status: 'indexed' | 'changed' | 'skipped' | 'failed';
  methods?: number;
  error?: string;
}

export interface ScanManifest {
  generationId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed';
  indexedFiles: number;
  changedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  totalMethods: number;
  parserVersion: string;
  vectorSchemaVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  insightPromptVersion: string;
  files: ScanManifestFile[];
  compactionCandidate?: boolean;
}

export interface SearchResult {
  type: 'method' | 'class' | 'memory';
  id?: string;
  file?: string;
  method?: string;
  class?: string;
  loc?: string;
  sig?: string;
  refs?: string[];
  insight?: string;
  text?: string;
  generationId?: string;
  namespace?: string;
  decorators?: string[];
  visibility?: string;
  isAsync?: boolean;
  isStatic?: boolean;
  parameters?: string[];
  returnType?: string;
  extends?: string;
  implements?: string[];
  imports?: string[];
  exports?: string[];
  score?: number;
  matchedBy?: Array<'name' | 'class' | 'signature' | 'file path' | 'memory' | 'refs' | 'insight'>;
  scoreParts?: {
    lexical?: number;
    vector?: number;
    memory?: number;
    symbol?: number;
    path?: number;
  };
  matchReason?: string;
  suggestedNext?: string;
  suggestedNextReason?: string;
  suggestedNextConfidence?: number;
  related?: Array<Pick<SearchResult, 'file' | 'method' | 'class' | 'loc' | 'sig'>>;
  searchIntent?: 'exact-symbol' | 'trace' | 'semantic' | 'dependency' | 'mixed';
  fallback?: {
    originalQuery: string;
    mode: 'exact' | 'regex' | 'vector' | 'normalized-exact' | 'semantic';
    from: 'exact' | 'regex' | 'vector';
    reason: string;
  };
  memoryHint?: string;
  searchTelemetry?: {
    route?: string;
    rerankUsed?: boolean;
    fallbackPath?: string[];
    topConfidence?: number;
  };
}

export interface CodeEntitySummary {
  name: string;
  loc: string;
  sig?: string;
  class?: string;
}

export interface CodeFileSummary {
  file: string;
  totalLines: number;
  importCount: number;
  imports: string[];
  classes: CodeEntitySummary[];
  methods: CodeEntitySummary[];
  memories?: MemoryRecord[];
  warning?: string;
  error?: string;
}

export interface ResolvedSymbolTarget {
  file: string;
  symbol: string;
  loc: string;
  sig?: string;
  type: 'method' | 'class';
  matchType?: 'exact' | 'qualified' | 'id' | 'fallback';
  confidence?: 'high' | 'medium' | 'low';
}

export interface SymbolCandidate extends ResolvedSymbolTarget {
  display: string;
}

export interface SymbolResolution {
  query: string;
  matched?: SymbolCandidate;
  candidates: SymbolCandidate[];
  ambiguous?: boolean;
  reason?: string;
}

export interface SmartSearchCandidate {
  id: string;
  type: 'method' | 'class' | 'memory';
  file?: string;
  method?: string;
  class?: string;
  loc?: string;
  sig?: string;
  refs?: string[];
  insight?: string;
  text?: string;
  score?: number;
}

export interface ProjectConfig {
  version: number;
  languages: string[];
  include: string[];
  exclude: string[];
  aiInsight: boolean;
  aiInsightConcurrency: number;
  watch: { debounceMs: number };
  search: {
    defaultLimit: number;
    maxLimit: number;
    smartSearchEnabled?: boolean;
    smartSearchCandidateMultiplier?: number;
    pausedSmartSearchEnabled?: boolean;
  };
  dependencyDepth: number;
}

export interface UserConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  pausedEmbedding?: EmbeddingConfig;
}

export interface LLMConfig {
  provider: string; // 'ollama' | 'openai' | 'anthropic' | 'none'
  endpoint?: string;
  apiKey?: string;
  model: string;
}

export interface EmbeddingConfig {
  provider: string; // 'ollama' | 'openai' | 'none'
  endpoint?: string;
  apiKey?: string;
  model: string;
}

export interface MemoryRecord {
  id: string;
  text: string;
  createdAt: string;
  ref?: string;
  file?: string;
  symbol?: string;
  symbolId?: string;
  scope?: 'project' | 'file' | 'symbol';
}

export interface TraceStep {
  file: string;
  symbol: string;
  loc?: string;
  refs: string[];
}

export interface TraceRelation {
  symbol: string;
  path: string;
  range: string;
  confidence: 'high' | 'medium' | 'low' | 'missing-index';
  kind: 'caller' | 'callee' | 'trace' | 'candidate';
  reason?: string;
}

export interface TraceSurfaceResult {
  target?: TraceRelation;
  results: TraceRelation[];
  related?: TraceRelation[];
  suggestedNext?: string;
  warning?: string;
}

export interface ScanProgress {
  phase: 'structure' | 'insight' | 'vectors';
  totalFiles: number;
  processedFiles: number;
  totalMethods: number;
  currentFile?: string;
  skipped?: boolean;
  insightResult?: InsightGenerationResult;
}

export type SyncStep = 'checksum' | 'parsing' | 'insight' | 'vectors' | 'done';

export interface SyncResult {
  file: string;
  action: 'deleted' | 'unchanged' | 'parsed' | 'indexed';
  methodsUpdated: number;
  methodsAdded: number;
  methodsRemoved: number;
}

export type ParsedClassInfo = Omit<ClassInfo, 'id'>;
export type ParsedMethodInfo = Omit<MethodInfo, 'id'>;

export interface ParsedFile {
  file: string;
  lang: string;
  classes: ParsedClassInfo[];
  methods: ParsedMethodInfo[];
  imports: string[];
  exports: string[];
}

export interface InsightQueueItem {
  file: string;
  methodId: string;
  methodName: string;
  methodCode: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retries: number;
  queuedAt: string;
}

export interface InsightGenerationResult {
  file: string;
  sentCount: number;
  methods: { id: string; name: string; insight: string }[];
  rawResponse?: string;
  prompt?: string;
  rawStdout?: string;
  error?: string;
}
