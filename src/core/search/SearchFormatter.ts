import { SearchResult } from '../interfaces/types';

export class SearchFormatter {
  static formatCompact(results: SearchResult[]): string {
    const grouped = new Map<string, SearchResult[]>();
    const memories: SearchResult[] = [];
    const notes = new Set<string>();

    for (const r of results) {
      if (r.matchReason) {
        notes.add(r.matchReason);
      }
      if (r.type === 'memory') {
        memories.push(r);
        continue;
      }
      const file = r.file || 'unknown';
      if (!grouped.has(file)) grouped.set(file, []);
      grouped.get(file)!.push(r);
    }

    const lines: string[] = [];

    for (const note of notes) {
      lines.push(`note: ${note}`);
    }
    if (notes.size > 0) {
      lines.push('');
    }

    for (const [file, methods] of grouped) {
      lines.push(file);
      for (const m of methods) {
        const params = m.sig ? SearchFormatter.extractParams(m.sig) : '';
        lines.push(`  ${m.method || m.class}(${params})[${m.loc}]`);
        if (m.suggestedNext) {
          lines.push(`    next: ${m.suggestedNext}`);
        }
        if (m.related?.length) {
          lines.push(`    related: ${m.related.map(item => `${item.method || item.class}[${item.loc}]`).join(', ')}`);
        }
      }
      lines.push('');
    }

    for (const mem of memories) {
      lines.push(`[memory${mem.file ? ` ${mem.file}` : ''}] ${mem.text}`);
      if (mem.suggestedNext) {
        lines.push(`  next: ${mem.suggestedNext}`);
      }
    }

    if (lines.length === 0) {
      return 'No results found. Try `nc search -r "<pattern>"` or `nc search -v "<concept>"`.';
    }

    return lines.join('\n').trim();
  }

  static formatDetailed(results: SearchResult[]): string {
    return JSON.stringify(
      results.map(r => ({
        type: r.type,
        file: r.file,
        method: r.method,
        class: r.class,
        loc: r.loc,
        sig: r.sig,
        refs: r.refs,
        insight: r.insight,
        text: r.text,
        matchReason: r.matchReason,
        suggestedNext: r.suggestedNext,
        suggestedNextReason: r.suggestedNextReason,
        suggestedNextConfidence: r.suggestedNextConfidence,
        related: r.related,
        searchIntent: r.searchIntent,
        searchTelemetry: r.searchTelemetry,
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
