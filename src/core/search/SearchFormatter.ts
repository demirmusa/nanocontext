import { SearchResult } from '../interfaces/types';

export class SearchFormatter {
  static formatCompact(results: SearchResult[]): string {
    const grouped = new Map<string, SearchResult[]>();
    const memories: SearchResult[] = [];

    for (const r of results) {
      if (r.type === 'memory') {
        memories.push(r);
        continue;
      }
      const file = r.file || 'unknown';
      if (!grouped.has(file)) grouped.set(file, []);
      grouped.get(file)!.push(r);
    }

    const lines: string[] = [];

    for (const [file, methods] of grouped) {
      lines.push(file);
      for (const m of methods) {
        const params = m.sig ? SearchFormatter.extractParams(m.sig) : '';
        lines.push(`  ${m.method || m.class}(${params})[${m.loc}]`);
      }
      lines.push('');
    }

    for (const mem of memories) {
      lines.push(`[memory] ${mem.text}`);
    }

    return lines.join('\n').trim();
  }

  static formatDetailed(results: SearchResult[]): string {
    return JSON.stringify(
      results.filter(r => r.type !== 'memory').map(r => ({
        file: r.file,
        class: r.class,
        loc: r.loc,
        sig: r.sig,
        refs: r.refs,
        insight: r.insight,
      })),
      null,
      2,
    );
  }

  private static extractParams(sig: string): string {
    const match = sig.match(/\(([^)]*)\)/);
    return match ? match[1] : '';
  }
}
