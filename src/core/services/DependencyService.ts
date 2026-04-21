import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { MethodInfo } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';
import { normalizeProjectPath } from '../../utils/projectPath';

export class DependencyService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
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

  private resolveMethods(methods: MethodInfo[], selector: string): MethodInfo[] {
    const normalizedSelector = selector.trim();
    if (!normalizedSelector) return [];

    return methods.filter(method => this.buildSelectorSet(method).has(normalizedSelector));
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
