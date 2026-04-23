import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { MethodInfo, TraceStep } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';
import { normalizeProjectPath } from '../../utils/projectPath';

export class DependencyService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
  ) {}

  async getRefs(filePath: string, methodSelector: string, depth?: number): Promise<string[]> {
    const normalizedPath = normalizeProjectPath(filePath, this.configManager.getProjectRoot());
    const header = await this.headerStore.read(normalizedPath);
    if (!header) return [];

    const normalizedHeader = applyHeaderIdentity(header);
    const maxDepth = Math.max(1, Math.min(depth ?? 1, 3));
    const rootMethods = this.resolveMethods(normalizedHeader.methods, methodSelector);
    if (rootMethods.length === 0) return [];

    const refs = new Set<string>();
    const visited = new Set<string>();

    const visit = (method: MethodInfo, currentDepth: number): void => {
      if (visited.has(method.id) || currentDepth > maxDepth) return;
      visited.add(method.id);

      for (const ref of method.refs) {
        refs.add(ref);
        if (currentDepth < maxDepth) {
          const nextMethods = this.resolveRefMethods(normalizedHeader.methods, ref);
          for (const nextMethod of nextMethods) {
            visit(nextMethod, currentDepth + 1);
          }
        }
      }
    };

    for (const root of rootMethods) {
      visit(root, 1);
    }

    return Array.from(refs).sort();
  }

  async getRefsForSymbol(symbol: string, depth?: number): Promise<string[]> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) return [];
    return this.getRefs(resolved.file, resolved.selector, depth);
  }

  async getCallers(symbol: string): Promise<Array<{ file: string; method: string; loc: string }>> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) return [];

    const callers: Array<{ file: string; method: string; loc: string }> = [];
    for (const file of this.stateStore.listTrackedFiles()) {
      const header = await this.headerStore.read(file);
      if (!header) continue;

      const normalizedHeader = applyHeaderIdentity(header);
      for (const method of normalizedHeader.methods) {
        const refs = method.refs ?? [];
        const candidates = new Set<string>([
          resolved.selector,
          resolved.method.name,
          resolved.method.class ? `${resolved.method.class}.${resolved.method.name}` : resolved.method.name,
        ]);
        if (refs.some(ref => this.expandReferenceCandidates(ref).size > 0 && [...this.expandReferenceCandidates(ref)].some(item => candidates.has(item)))) {
          callers.push({
            file,
            method: method.class ? `${method.class}.${method.name}` : method.name,
            loc: method.loc,
          });
        }
      }
    }

    return callers;
  }

  async traceSymbol(symbol: string, depth?: number): Promise<TraceStep[]> {
    const resolved = await this.resolveSymbol(symbol);
    if (!resolved) return [];

    const steps: TraceStep[] = [];
    const maxDepth = Math.max(1, Math.min(depth ?? 3, 5));
    const visited = new Set<string>();

    const visit = async (file: string, method: MethodInfo, currentDepth: number): Promise<void> => {
      const key = `${file}:${method.id}`;
      if (visited.has(key) || currentDepth > maxDepth) return;
      visited.add(key);

      steps.push({
        file,
        symbol: method.class ? `${method.class}.${method.name}` : method.name,
        loc: method.loc,
        refs: [...method.refs],
      });

      if (currentDepth === maxDepth) return;
      for (const ref of method.refs) {
        const next = await this.resolveSymbol(ref);
        if (next) {
          await visit(next.file, next.method, currentDepth + 1);
        }
      }
    };

    await visit(resolved.file, resolved.method, 1);
    return steps;
  }

  private resolveMethods(methods: MethodInfo[], selector: string): MethodInfo[] {
    const normalizedSelector = selector.trim();
    if (!normalizedSelector) return [];

    return methods.filter(method => this.buildSelectorSet(method).has(normalizedSelector));
  }

  private async resolveSymbol(symbol: string): Promise<{ file: string; method: MethodInfo; selector: string } | null> {
    const candidates = [
      ...this.stateStore.searchExact(symbol, 10),
      ...this.stateStore.searchRegex(escapeRegex(symbol), 10),
    ];

    for (const candidate of candidates) {
      if (!candidate.file || candidate.type !== 'method') {
        continue;
      }
      const header = await this.headerStore.read(candidate.file);
      if (!header) continue;
      const normalizedHeader = applyHeaderIdentity(header);
      const methods = this.resolveMethods(normalizedHeader.methods, symbol);
      if (methods.length > 0) {
        return { file: candidate.file, method: methods[0], selector: symbol };
      }
      const fallback = normalizedHeader.methods.find(method => method.id === candidate.id || method.loc === candidate.loc);
      if (fallback) {
        return { file: candidate.file, method: fallback, selector: symbol };
      }
    }

    return null;
  }

  private resolveRefMethods(methods: MethodInfo[], ref: string): MethodInfo[] {
    const candidates = this.expandReferenceCandidates(ref);
    return methods.filter(method => {
      const selectors = this.buildSelectorSet(method);
      for (const candidate of candidates) {
        if (selectors.has(candidate)) {
          return true;
        }
      }
      return false;
    });
  }

  private buildSelectorSet(method: MethodInfo): Set<string> {
    const selectors = new Set<string>([method.id, method.name]);

    if (method.class) {
      selectors.add(`${method.class}.${method.name}`);
    }

    return selectors;
  }

  private expandReferenceCandidates(ref: string): Set<string> {
    const normalizedRef = ref.trim().replace(/\?\./g, '.');
    const candidates = new Set<string>([normalizedRef]);
    const dotSegments = normalizedRef.split('.');

    if (dotSegments.length > 1) {
      candidates.add(dotSegments[dotSegments.length - 1]);
      candidates.add(dotSegments.slice(-2).join('.'));
    }

    if (normalizedRef.startsWith('this.')) {
      candidates.add(normalizedRef.slice('this.'.length));
    }

    if (normalizedRef.startsWith('super.')) {
      candidates.add(normalizedRef.slice('super.'.length));
    }

    return candidates;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
