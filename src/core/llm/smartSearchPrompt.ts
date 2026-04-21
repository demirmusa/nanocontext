import { SmartSearchCandidate } from '../interfaces/types';

export function buildSmartSearchPrompt(
  query: string,
  candidates: SmartSearchCandidate[],
  limit: number,
): string {
  const renderedCandidates = candidates.map((candidate) => JSON.stringify({
    id: candidate.id,
    type: candidate.type,
    file: candidate.file,
    method: candidate.method,
    class: candidate.class,
    loc: candidate.loc,
    sig: candidate.sig,
    refs: candidate.refs,
    insight: candidate.insight,
    text: candidate.text,
    distance: candidate.score,
  })).join('\n');

  return `You are reranking semantic code search candidates for a developer query.

Query:
${query}

Task:
- Select the candidates that are truly relevant to the query.
- Return at most ${limit} candidates.
- Prefer precision over recall.
- Do not invent candidate IDs.
- Distance is semantic vector distance, so lower values are usually better.

Return JSON only in this format:
{"selectedIds":["candidate-id-1","candidate-id-2"]}

Candidates:
${renderedCandidates}`;
}

export function parseSmartSearchResponse(content: string, candidateIds: string[]): string[] {
  const normalized = content.trim();
  const validIds = new Set(candidateIds);
  const fromJson = tryParseIds(normalized, validIds);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const fallback: string[] = [];
  for (const id of candidateIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9:_-])${escapeRegExp(id)}([^A-Za-z0-9:_-]|$)`);
    if (pattern.test(normalized)) {
      fallback.push(id);
    }
  }
  return fallback;
}

function tryParseIds(content: string, validIds: Set<string>): string[] {
  const candidates = [content];
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { selectedIds?: unknown; ids?: unknown };
      const ids = Array.isArray(parsed.selectedIds)
        ? parsed.selectedIds
        : Array.isArray(parsed.ids)
          ? parsed.ids
          : [];
      const filtered = ids
        .filter((value): value is string => typeof value === 'string')
        .filter(id => validIds.has(id));
      if (filtered.length > 0) {
        return filtered;
      }
    } catch {
      // Ignore invalid JSON and fall back to ID scanning.
    }
  }

  return [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
