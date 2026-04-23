import * as fs from 'fs';
import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { CodeFileSummary, MemoryRecord, ResolvedSymbolTarget, SearchResult } from '../interfaces/types';
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
        warning: `No header found for ${relativePath}. Run \`nc scan -f ${relativePath}\` to generate structure metadata.`,
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
    const resolved = target.includes('#')
      ? await this.resolveFileScopedSymbol(target)
      : this.resolveIndexedSymbol(target);

    if (!resolved) {
      throw new Error(`No symbol match found for ${target}.`);
    }

    return {
      target: resolved,
      snippet: this.readSnippet(resolved.file, resolved.loc),
      memories: await this.memoryStore.listByFile(resolved.file),
    };
  }

  async peekTarget(target: string, options?: TargetPreviewOptions): Promise<ResolvedSymbolSnippetResult> {
    return this.readTargetPreview(target, options?.around ?? 3, 40, options);
  }

  async openTarget(target: string, options?: TargetPreviewOptions): Promise<ResolvedSymbolSnippetResult> {
    return this.readTargetPreview(target, options?.around ?? 12, 120, options);
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

  private async resolveFileScopedSymbol(target: string): Promise<ResolvedSymbolTarget | null> {
    const separatorIndex = target.indexOf('#');
    const filePath = target.slice(0, separatorIndex);
    const symbol = target.slice(separatorIndex + 1).trim();
    if (!symbol) {
      return null;
    }

    const summary = await this.readFileSummary(filePath);
    if (summary.error) {
      return null;
    }

    const header = await this.headerStore.read(summary.file);
    if (!header) {
      return null;
    }

    const normalizedSymbol = symbol.toLowerCase();
    const method = header.methods.find(item =>
      item.name.toLowerCase() === normalizedSymbol
      || `${item.class ?? ''}.${item.name}`.toLowerCase() === normalizedSymbol,
    );
    if (method) {
      return {
        file: header.file,
        symbol,
        loc: method.loc,
        sig: method.sig,
        type: 'method',
      };
    }

    const cls = header.classes.find(item => item.name.toLowerCase() === normalizedSymbol);
    if (cls) {
      return {
        file: header.file,
        symbol,
        loc: cls.loc,
        type: 'class',
      };
    }

    return null;
  }

  private resolveIndexedSymbol(target: string): ResolvedSymbolTarget | null {
    const exact = this.pickSymbolResult(this.stateStore.searchExact(target, 5), target);
    if (exact) {
      return exact;
    }

    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.pickSymbolResult(this.stateStore.searchRegex(escaped, 5), target);
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

    const resolved = target.includes('#')
      ? await this.resolveFileScopedSymbol(target)
      : this.resolveIndexedSymbol(target);

    if (!resolved) {
      throw new Error(`No symbol match found for ${target}.`);
    }

    if (options?.classContext && resolved.type === 'method') {
      const classTarget = await this.resolveClassContext(resolved);
      if (classTarget) {
      return {
        target: classTarget,
        snippet: this.readSnippet(classTarget.file, classTarget.loc),
        memories: await this.memoryStore.listByFile(classTarget.file),
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
      memories: await this.memoryStore.listByFile(resolved.file),
    };
  }

  private pickSymbolResult(results: SearchResult[], rawTarget: string): ResolvedSymbolTarget | null {
    const normalizedTarget = rawTarget.toLowerCase();

    for (const result of results) {
      if (!result.file || !result.loc || (result.type !== 'method' && result.type !== 'class')) {
        continue;
      }

      const methodName = result.method?.toLowerCase();
      const className = result.class?.toLowerCase();
      const qualifiedName = methodName && className ? `${className}.${methodName}` : undefined;

      if (
        methodName === normalizedTarget
        || className === normalizedTarget
        || qualifiedName === normalizedTarget
      ) {
        return {
          file: result.file,
          symbol: rawTarget,
          loc: result.loc,
          sig: result.sig,
          type: result.type,
        };
      }
    }

    const fallback = results.find(result =>
      result.file
      && result.loc
      && (result.type === 'method' || result.type === 'class'),
    );

    if (!fallback || !fallback.file || !fallback.loc || (fallback.type !== 'method' && fallback.type !== 'class')) {
      return null;
    }

    return {
      file: fallback.file,
      symbol: rawTarget,
      loc: fallback.loc,
      sig: fallback.sig,
      type: fallback.type,
    };
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
}

function expandLoc(loc: string, padding: number): string {
  const [start, end] = loc.split('-').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return loc;
  }

  return `${Math.max(1, start - padding)}-${end + padding}`;
}
