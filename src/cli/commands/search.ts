import * as fs from 'fs';
import { Container } from '../../core/Container';
import { CodeEntitySummary } from '../../core/interfaces/types';
import { SearchFormatter } from '../../core/search/SearchFormatter';
import { resolveProjectPath } from '../../utils/projectPath';
import { colors } from '../utils/colors';
import { buildSearchRequest } from './searchRequest';

const DEFAULT_FILE_SEARCH_LIMIT = 5;
const DEFAULT_BATCH_RESULT_BUDGET = 8;

export async function searchCommand(query: string | undefined, options: { query?: string[]; file?: string; deep?: boolean; exact?: boolean; vector?: boolean; regex?: boolean; limit?: string; explain?: boolean }): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const queries = collectQueries(query, options.query);
    if (queries.length === 0) {
      console.error(colors.red('Provide a query. Use `nc search "A|B|C"` for related batch searches.'));
      process.exit(1);
    }

    const implicitBatchLimit = resolveImplicitBatchLimit(queries.length, options.limit);
    for (const [index, currentQuery] of queries.entries()) {
      if (options.file) {
        const output = await searchFile(container, options.file, currentQuery, parseLimit(options.limit) ?? implicitBatchLimit);
        if (queries.length > 1) {
          if (index > 0) {
            console.log('');
          }
          console.log(colors.bold(`Query: ${currentQuery}`));
        }
        console.log(output);
        continue;
      }

      const results = await container.searchService.execute({
        ...buildSearchRequest(currentQuery, {
          ...options,
          limit: options.limit ?? String(implicitBatchLimit),
        }),
      });
      if (queries.length > 1) {
        if (index > 0) {
          console.log('');
        }
        console.log(colors.bold(`Query: ${currentQuery}`));
      }
      if (options.explain) {
        console.log(SearchFormatter.formatExplain(currentQuery, results));
      } else {
        console.log(options.deep ? SearchFormatter.formatDetailed(results) : SearchFormatter.formatCompact(results));
      }
    }
  } catch (err) {
    console.error(colors.red(`Search failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

async function searchFile(container: Container, filePath: string, query: string, limit?: number): Promise<string> {
  const resolvedFile = container.codeReadService.resolveIndexedFilePath(filePath) ?? filePath;
  const summary = await container.codeReadService.readFileSummary(resolvedFile);
  const { absolutePath } = resolveProjectPath(summary.file, container.configManager.getProjectRoot());
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const maxResults = limit ?? DEFAULT_FILE_SEARCH_LIMIT;
  const { matches, total, truncated } = findFileSearchMatches(summary.classes, summary.methods, content, query, maxResults);

  if (matches.length === 0) {
    return colors.dim(`No matches in ${summary.file}.`);
  }

  return [
    colors.bold(summary.file),
    ...matches.map(item => {
      if (item.kind === 'line') {
        return `line:${item.line} ${item.text}`;
      }
      const owner = item.class ? `${item.class}#` : '';
      return `${item.kind}:${owner}${item.name} [${item.loc}]`;
    }),
    ...(truncated ? [colors.dim(`...(total result ${total}, limit ${maxResults})`)] : []),
  ].join('\n');
}

export function findFileSearchMatches(
  classes: CodeEntitySummary[],
  methods: CodeEntitySummary[],
  content: string,
  query: string,
  limit: number = DEFAULT_FILE_SEARCH_LIMIT,
): {
  matches: Array<
    | (CodeEntitySummary & { kind: 'class' | 'method' })
    | { kind: 'line'; line: number; text: string }
  >;
  total: number;
  truncated: boolean;
} {
  const normalized = query.toLowerCase();
  const entityMatchesList = [
    ...classes.filter(item => entityMatches(item, normalized)).map(item => ({ ...item, kind: 'class' as const })),
    ...methods.filter(item => entityMatches(item, normalized)).map(item => ({ ...item, kind: 'method' as const })),
  ];
  const matchedRanges = entityMatchesList.map(item => parseLoc(item.loc)).filter(range => range !== null);
  const lineMatches = content
    .split('\n')
    .map((text, index) => ({ kind: 'line' as const, line: index + 1, text: text.trim() }))
    .filter(item =>
      item.text.toLowerCase().includes(normalized)
      && !matchedRanges.some(range => range && item.line >= range.start && item.line <= range.end)
    );
  const matches = [...entityMatchesList, ...lineMatches];
  return {
    matches: matches.slice(0, limit),
    total: matches.length,
    truncated: matches.length > limit,
  };
}

function entityMatches(entity: CodeEntitySummary, normalizedQuery: string): boolean {
  return [
    entity.name,
    entity.class,
    entity.class ? `${entity.class}#${entity.name}` : undefined,
    entity.class ? `${entity.class}.${entity.name}` : undefined,
    entity.sig,
  ].some(value => value?.toLowerCase().includes(normalizedQuery));
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : undefined;
}

export function resolveImplicitBatchLimit(queryCount: number, explicitLimit?: string): number {
  const parsed = parseLimit(explicitLimit);
  if (parsed !== undefined) {
    return parsed;
  }
  if (queryCount <= 1) {
    return 3;
  }
  return Math.max(1, Math.floor(DEFAULT_BATCH_RESULT_BUDGET / queryCount));
}

function parseLoc(loc: string): { start: number; end: number } | null {
  const [start, end] = loc.split('-').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return null;
  }
  return { start, end };
}

export function collectQueries(query: string | undefined, batchQueries?: string[]): string[] {
  const values = [
    ...(query ? [query] : []),
    ...(batchQueries ?? []),
  ].flatMap(item => item.split('|'))
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}
