import { SearchResult } from '../interfaces/types';

export class SearchFormatter {
  static formatCompact(results: SearchResult[]): string {
    const grouped = new Map<string, SearchResult[]>();
    const memories: SearchResult[] = [];
    const fallback = results[0]?.fallback;

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
    if (fallback) {
      lines.push(`fallback: ${fallback.mode} (${fallback.reason})`);
      lines.push('');
    }

    for (const [file, methods] of grouped) {
      lines.push(file);
      for (const m of methods) {
        const params = m.sig ? SearchFormatter.extractParams(m.sig) : '';
        lines.push(`  ${m.method || m.class}(${params})[${m.loc}]`);
        if (m.related?.length) {
          lines.push(`    related: ${m.related.map(item => `${item.method || item.class}[${item.loc}]`).join(', ')}`);
        }
        if (m.memoryHint) {
          lines.push(`    memory: ${m.memoryHint}`);
        }
      }
      lines.push('');
    }

    for (const mem of memories) {
      lines.push(`[memory${mem.file ? ` ${mem.file}` : ''}] ${mem.text}`);
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
        score: r.score,
        matchedBy: r.matchedBy,
        scoreParts: r.scoreParts,
        refs: r.refs,
        namespace: r.namespace,
        decorators: r.decorators,
        visibility: r.visibility,
        isAsync: r.isAsync,
        isStatic: r.isStatic,
        parameters: r.parameters,
        returnType: r.returnType,
        extends: r.extends,
        implements: r.implements,
        imports: r.imports,
        exports: r.exports,
        insight: r.insight,
        text: r.text,
        matchReason: r.matchReason,
        suggestedNext: r.suggestedNext,
        suggestedNextReason: r.suggestedNextReason,
        suggestedNextConfidence: r.suggestedNextConfidence,
        fallback: r.fallback,
        memoryHint: r.memoryHint,
        related: r.related,
        searchIntent: r.searchIntent,
        searchTelemetry: r.searchTelemetry,
      })),
      null,
      2,
    );
  }

  static formatExplain(query: string, results: SearchResult[]): string {
    const lines: string[] = [`Search explain: "${query}"`];
    const telemetry = results[0]?.searchTelemetry;
    if (telemetry) {
      lines.push(`route: ${(telemetry.fallbackPath ?? [telemetry.route]).filter(Boolean).join(' > ')}`);
      lines.push(`rerank: ${telemetry.rerankUsed === undefined ? 'n/a' : telemetry.rerankUsed ? 'yes' : 'no'}`);
    }
    if (results[0]?.fallback) {
      const fallback = results[0].fallback;
      lines.push(`fallback: ${fallback.mode} from ${fallback.from} (${fallback.reason})`);
    }
    lines.push('');

    if (results.length === 0) {
      lines.push('No results found.');
      return lines.join('\n');
    }

    for (const [index, result] of results.entries()) {
      const label = result.type === 'memory'
        ? `[memory] ${result.text ?? result.id ?? 'memory'}`
        : `${result.file ?? 'unknown'} ${result.method ?? result.class ?? ''}${result.loc ? `[${result.loc}]` : ''}`.trim();
      lines.push(`${index + 1}. ${label}`);
      lines.push(`   score: ${result.score ?? 'n/a'}`);
      if (result.matchedBy?.length) {
        lines.push(`   matchedBy: ${result.matchedBy.join(', ')}`);
      }
      if (result.scoreParts) {
        lines.push(`   scoreParts: ${formatScoreParts(result.scoreParts)}`);
      }
      if (result.matchReason) {
        lines.push(`   reason: ${result.matchReason}`);
      }
      if (result.related?.length) {
        lines.push(`   related: ${result.related.map(item => `${item.method || item.class}[${item.loc}]`).join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  private static extractParams(sig: string): string {
    const match = sig.match(/\(([^)]*)\)/);
    return match ? match[1] : '';
  }
}

function formatScoreParts(scoreParts: NonNullable<SearchResult['scoreParts']>): string {
  return Object.entries(scoreParts)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}
