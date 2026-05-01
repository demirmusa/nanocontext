import * as fs from 'fs';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { CodeFileSummary, MemoryRecord, ResolvedSymbolTarget, SearchResult, SymbolCandidate, SymbolResolution } from '../interfaces/types';
import { ProjectPathError, resolveProjectPath } from '../../utils/projectPath';

export interface CodeSnippetResult {
  content: string;
  warning?: string;
  error?: string;
}

export interface ResolvedSymbolSnippetResult {
  target: ResolvedSymbolTarget;
  snippet: CodeSnippetResult;
  memories?: MemoryRecord[];
}

export interface TargetPreviewOptions {
  around?: number;
  classContext?: boolean;
  top?: boolean;
}

export class CodeReadService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private memoryStore: IMemoryStore,
  ) {}

  readSnippet(filePath: string, loc: string): CodeSnippetResult {
    const projectRoot = this.configManager.getProjectRoot();
    const { absolutePath } = resolveProjectPath(filePath, projectRoot);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const allLines = content.split('\n');
    const total = allLines.length;
    const [start, end] = loc.split('-').map(Number);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
      return { content: '', error: `invalid line range: ${loc}` };
    }

    if (start > total) {
      return { content: '', error: `lines ${start}-${end} out of range. File has ${total} lines (1-${total}).` };
    }

    const clampedEnd = Math.min(end, total);
    return {
      content: allLines.slice(start - 1, clampedEnd).join('\n'),
      warning: end > total ? `[truncated: file has ${total} lines]` : undefined,
    };
  }

  async readFileSummary(filePath: string): Promise<CodeFileSummary> {
    const projectRoot = this.configManager.getProjectRoot();
    const { relativePath, absolutePath } = resolveProjectPath(filePath, projectRoot);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const totalLines = content.split('\n').length;
    const header = await this.headerStore.read(relativePath);

    if (!header) {
      return {
        file: relativePath,
        totalLines,
        importCount: 0,
        imports: [],
        classes: [],
        methods: [],
        memories: await this.memoryStore.listByFile(relativePath),
      };
    }

    return {
      file: header.file,
      totalLines,
      importCount: header.imports.length,
      imports: header.imports,
      classes: header.classes.map(cls => ({
        name: cls.name,
        loc: cls.loc,
      })),
      methods: header.methods.map(method => ({
        name: method.name,
        class: method.class,
        loc: method.loc,
        sig: method.sig,
      })),
      memories: await this.memoryStore.listByFile(header.file),
    };
  }

  async readSymbolSnippet(target: string): Promise<ResolvedSymbolSnippetResult> {
    const resolution = await this.resolveSymbolTarget(target);
    if (!resolution.matched || resolution.ambiguous) {
      throw new Error(`No symbol match found for ${target}.`);
    }
    const resolved = resolution.matched;

    return {
      target: resolved,
      snippet: this.readSnippet(resolved.file, resolved.loc),
      memories: await this.collectMemoriesForTarget(resolved),
    };
  }

  async peekTarget(target: string, options?: TargetPreviewOptions): Promise<ResolvedSymbolSnippetResult> {
    return this.readTargetPreview(target, options?.around ?? 3, 40, options);
  }

  async openTarget(target: string, options?: TargetPreviewOptions): Promise<ResolvedSymbolSnippetResult> {
    return this.readTargetPreview(target, options?.around ?? 12, 120, options);
  }

  async resolveSymbolTarget(target: string): Promise<SymbolResolution> {
    const trimmed = target.trim();
    if (!trimmed) {
      return { query: target, candidates: [], reason: 'empty query' };
    }

    const candidates = trimmed.includes('#') && this.hasFileScopedPrefix(trimmed)
      ? await this.resolveFileScopedSymbolCandidates(trimmed)
      : await this.resolveIndexedSymbolCandidates(trimmed);

    if (candidates.length === 0) {
      return { query: target, candidates: [], reason: 'no indexed symbol match' };
    }

    const [matched, ...rest] = candidates;
    return {
      query: target,
      matched,
      candidates,
      ambiguous: rest.length > 0 && sameResolutionScore(matched, rest[0]),
      reason: rest.length > 0 ? `top candidates: ${candidates.slice(0, 3).map(candidate => `${candidate.display} ${candidate.file}[${candidate.loc}]`).join('; ')}` : undefined,
    };
  }

  async readSnippetAround(filePath: string, loc: string, around: number): Promise<ResolvedSymbolSnippetResult> {
    const expandedLoc = expandLoc(loc, around);
    return {
      target: {
        file: filePath,
        symbol: filePath,
        loc: expandedLoc,
        type: 'class',
      },
      snippet: this.readSnippet(filePath, expandedLoc),
      memories: await this.memoryStore.listByFile(filePath),
    };
  }

  isLikelyFilePath(target: string): boolean {
    if (target.includes('#')) {
      return false;
    }

    try {
      const { absolutePath } = resolveProjectPath(target, this.configManager.getProjectRoot());
      return fs.existsSync(absolutePath);
    } catch (error) {
      if (error instanceof ProjectPathError) {
        return false;
      }
      throw error;
    }
  }

  private async resolveFileScopedSymbolCandidates(target: string): Promise<SymbolCandidate[]> {
    const separatorIndex = target.indexOf('#');
    const filePath = target.slice(0, separatorIndex);
    const symbol = target.slice(separatorIndex + 1).trim();
    if (!symbol) {
      return [];
    }

    const summary = await this.readFileSummary(filePath);
    if (summary.error) {
      return [];
    }

    const header = await this.headerStore.read(summary.file);
    if (!header) {
      return [];
    }

    const normalizedSymbol = symbol.toLowerCase();
    const methodMatches = header.methods.filter(item =>
      item.name.toLowerCase() === normalizedSymbol
      || `${item.class ?? ''}.${item.name}`.toLowerCase() === normalizedSymbol,
    );
    const classMatches = header.classes.filter(item => item.name.toLowerCase() === normalizedSymbol);
    return [
      ...methodMatches.map(method => ({
        file: header.file,
        symbol: method.class ? `${method.class}#${method.name}` : method.name,
        display: method.class ? `${method.class}#${method.name}` : method.name,
        loc: method.loc,
        sig: method.sig,
        type: 'method' as const,
        matchType: 'qualified' as const,
        confidence: 'high' as const,
      })),
      ...classMatches.map(cls => ({
        file: header.file,
        symbol: cls.name,
        display: cls.name,
        loc: cls.loc,
        type: 'class' as const,
        matchType: 'exact' as const,
        confidence: 'high' as const,
      })),
    ];
  }

  private hasFileScopedPrefix(target: string): boolean {
    const separatorIndex = target.indexOf('#');
    if (separatorIndex <= 0) {
      return false;
    }

    const prefix = target.slice(0, separatorIndex);
    if (!/[\\/]|^\.[\\/]|[.][A-Za-z0-9]+$/.test(prefix)) {
      return false;
    }

    try {
      const { absolutePath } = resolveProjectPath(prefix, this.configManager.getProjectRoot());
      return fs.existsSync(absolutePath);
    } catch (error) {
      if (error instanceof ProjectPathError) {
        return false;
      }
      throw error;
    }
  }

  private async resolveIndexedSymbolCandidates(target: string): Promise<SymbolCandidate[]> {
    const exactResults = indexedSymbolQueries(target).flatMap(query => this.stateStore.searchExact(query, 8));
    const exact = this.pickSymbolResults(exactResults, target);
    if (exact.length > 0) {
      return exact;
    }

    const regexResults = indexedSymbolQueries(target).flatMap(query => {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return this.stateStore.searchRegex(escaped, 8);
    });
    return this.pickSymbolResults(regexResults, target);
  }

  private async readTargetPreview(
    target: string,
    symbolPadding: number,
    fileLineCount: number,
    options?: TargetPreviewOptions,
  ): Promise<ResolvedSymbolSnippetResult> {
    if (this.isLikelyFilePath(target)) {
      const summary = await this.readFileSummary(target);
      const upperBound = Math.min(summary.totalLines, options?.top ? Math.max(fileLineCount, 120) : fileLineCount);
      return {
        target: {
          file: summary.file,
          symbol: summary.file,
          loc: `1-${upperBound}`,
          type: 'class',
        },
        snippet: this.readSnippet(summary.file, `1-${upperBound}`),
        memories: await this.memoryStore.listByFile(summary.file),
      };
    }

    const resolution = await this.resolveSymbolTarget(target);
    if (!resolution.matched) {
      throw new Error(`No symbol match found for ${target}.`);
    }
    if (resolution.ambiguous) {
      throw new Error(`Ambiguous symbol target "${target}". ${resolution.reason}`);
    }
    const resolved = resolution.matched;

    if (options?.classContext && resolved.type === 'method') {
      const classTarget = await this.resolveClassContext(resolved);
      if (classTarget) {
      return {
        target: classTarget,
        snippet: this.readSnippet(classTarget.file, classTarget.loc),
        memories: await this.collectMemoriesForTarget(classTarget),
      };
    }
    }

    const previewLoc = expandLoc(resolved.loc, symbolPadding);
    return {
      target: {
        ...resolved,
        loc: previewLoc,
      },
      snippet: this.readSnippet(resolved.file, previewLoc),
      memories: await this.collectMemoriesForTarget(resolved),
    };
  }

  private pickSymbolResults(results: SearchResult[], rawTarget: string): SymbolCandidate[] {
    const normalizedTarget = rawTarget.toLowerCase();
    const candidates: Array<SymbolCandidate & { score: number }> = [];

    for (const result of results) {
      if (!result.file || !result.loc || (result.type !== 'method' && result.type !== 'class')) {
        continue;
      }

      const methodName = result.method?.toLowerCase();
      const className = result.class?.toLowerCase();
      const qualifiedName = methodName && className ? `${className}.${methodName}` : undefined;

      let score = 40;
      let matchType: SymbolCandidate['matchType'] = 'fallback';
      let confidence: SymbolCandidate['confidence'] = 'low';
      if (qualifiedName === normalizedTarget || `${className}#${methodName}` === normalizedTarget) {
        score = 120;
        matchType = 'qualified';
        confidence = 'high';
      } else if (methodName === normalizedTarget || className === normalizedTarget) {
        score = 100;
        matchType = 'exact';
        confidence = 'high';
      } else if (result.id?.toLowerCase() === normalizedTarget) {
        score = 90;
        matchType = 'id';
        confidence = 'medium';
      }

      candidates.push({
        file: result.file,
        symbol: result.type === 'method' ? (result.class ? `${result.class}#${result.method}` : `${result.method}`) : (result.class || rawTarget),
        display: result.type === 'method' ? (result.class ? `${result.class}#${result.method}` : `${result.method}`) : (result.class || rawTarget),
        loc: result.loc,
        sig: result.sig,
        type: result.type,
        matchType,
        confidence,
        score,
      });
    }

    return dedupeCandidates(candidates)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.loc.localeCompare(b.loc))
      .map(({ score: _score, ...candidate }) => candidate);
  }

  private async resolveClassContext(target: ResolvedSymbolTarget): Promise<ResolvedSymbolTarget | null> {
    const header = await this.headerStore.read(target.file);
    if (!header) {
      return null;
    }

    const method = header.methods.find(item => item.loc === target.loc && item.sig === target.sig);
    const className = method?.class;
    if (!className) {
      return null;
    }

    const cls = header.classes.find(item => item.name === className);
    if (!cls) {
      return null;
    }

    return {
      file: target.file,
      symbol: className,
      loc: cls.loc,
      type: 'class',
    };
  }

  private async collectMemoriesForTarget(target: ResolvedSymbolTarget): Promise<MemoryRecord[]> {
    if (!target.matchType && !target.confidence) {
      return this.memoryStore.listByFile(target.file);
    }

    const symbolId = `${target.file}:${target.loc}:${target.type}:${target.symbol}`;
    const symbolMemories = typeof this.memoryStore.listBySymbol === 'function'
      ? await this.memoryStore.listBySymbol(symbolId)
      : [];
    if (symbolMemories.length > 0) {
      return symbolMemories;
    }
    return this.memoryStore.listByFile(target.file);
  }
}

function expandLoc(loc: string, padding: number): string {
  const [start, end] = loc.split('-').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return loc;
  }

  return `${Math.max(1, start - padding)}-${end + padding}`;
}

function sameResolutionScore(a: SymbolCandidate, b: SymbolCandidate): boolean {
  return (a.confidence ?? 'low') === (b.confidence ?? 'low') && (a.matchType ?? 'fallback') === (b.matchType ?? 'fallback');
}

function indexedSymbolQueries(target: string): string[] {
  const queries = [target];
  if (target.includes('#')) {
    const [className, methodName] = target.split('#');
    if (className && methodName) {
      queries.push(`${className}.${methodName}`, methodName, className);
    }
  }
  return [...new Set(queries)];
}

function dedupeCandidates(candidates: Array<SymbolCandidate & { score: number }>): Array<SymbolCandidate & { score: number }> {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.file}:${candidate.loc}:${candidate.display}:${candidate.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
