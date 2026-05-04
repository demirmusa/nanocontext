import { Container } from '../../core/Container';
import { AmbiguousSymbolTargetError } from '../../core/services/CodeReadService';
import { SymbolCandidate } from '../../core/interfaces/types';
import { colors } from '../utils/colors';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_SUMMARY_LIMIT = 10;
const DEFAULT_SNIPPET_LINE_LIMIT = 80;
const READ_HISTORY_FILE = path.join('.nanocontext', 'read-history.json');

export async function getCommand(target: string, options: { around?: string; full?: boolean } = {}): Promise<void> {
  const match = target.match(/^(.+)\[(\d+)-(\d+)\]$/);
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    if (!match) {
      if (!container.codeReadService.isLikelyFilePath(target)) {
        const around = parseAroundOption(options.around, 0);
        const resolved = around > 0
          ? await container.codeReadService.peekTarget(target, { around })
          : await container.codeReadService.readSymbolSnippet(target);
        if (!options.full && shouldSuppressRepeatedRead(container.configManager.getProjectRoot(), resolved.target.file, resolved.target.loc)) {
          console.log(colors.dim(`Already read ${resolved.target.file}[${resolved.target.loc}] in this workspace. Use --full to print it again.`));
          return;
        }
        renderResolvedSnippet(resolved.target, resolved.snippet.content, { full: options.full });
        rememberRead(container.configManager.getProjectRoot(), resolved.target.file, resolved.target.loc);
        renderMemories(resolved.memories);

        if (resolved.snippet.warning) {
          console.warn(colors.yellow(resolved.snippet.warning));
        }
        return;
      }

      const summary = await container.codeReadService.readFileSummary(target);

      if (summary.error) {
        console.error(colors.red(summary.error));
        process.exit(1);
      }

      console.log(colors.bold(summary.file) + colors.dim(` [${summary.totalLines} lines]`));
      console.log(colors.dim(`imports:${summary.importCount} classes:${summary.classes.length} methods:${summary.methods.length}`));

      if (options.full && summary.imports.length > 0) {
        console.log(colors.dim(`imports: ${summary.imports.join(', ')}`));
      }

      if (summary.classes.length > 0) {
        console.log(colors.cyan('Classes:'));
        for (const cls of summary.classes) {
          console.log(`  ${cls.name} [${cls.loc}]`);
        }
      }

      if (summary.methods.length > 0) {
        console.log(colors.cyan('Methods:'));
        if (options.full) {
          renderFullMethods(summary.methods, summary.classes.length);
        } else {
          renderCompactMethods(summary.methods);
        }
      }

      if (summary.warning) {
        console.log(colors.yellow(summary.warning));
      }
      renderMemories(summary.memories);
      return;
    }

    const [, filePath, startStr, endStr] = match;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    if (start > end || start < 1) {
      console.error(colors.red(`Invalid line range: ${start}-${end}`));
      console.error(colors.dim('Use `nc get <file>` for a compact file summary.'));
      process.exit(1);
    }

    const around = parseAroundOption(options.around, 0);
    const snippetResult = around > 0
      ? await container.codeReadService.readSnippetAround(filePath, `${start}-${end}`, around)
      : {
        target: { file: filePath, loc: `${start}-${end}` },
        snippet: container.codeReadService.readSnippet(filePath, `${start}-${end}`),
      };
    const snippet = snippetResult.snippet;

    if (snippet.error) {
      console.error(colors.red(snippet.error));
      process.exit(1);
    }

    if (snippet.warning) {
      console.warn(colors.yellow(snippet.warning));
    }

    if (!options.full && shouldSuppressRepeatedRead(container.configManager.getProjectRoot(), snippetResult.target.file, snippetResult.target.loc)) {
      console.log(colors.dim(`Already read ${snippetResult.target.file}[${snippetResult.target.loc}] in this workspace. Use --full to print it again.`));
      return;
    }

    renderResolvedSnippet(snippetResult.target, snippet.content, { full: options.full });
    rememberRead(container.configManager.getProjectRoot(), snippetResult.target.file, snippetResult.target.loc);
  } catch (err) {
    if (err instanceof AmbiguousSymbolTargetError) {
      renderSymbolCandidates(err.resolution.candidates);
      return;
    }
    console.error(colors.red(`Get failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function parseAroundOption(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRange(loc: string): { start: number; end: number } | null {
  const [start, end] = loc.split('-').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return null;
  }
  return { start, end };
}

function renderResolvedSnippet(
  target: { file: string; loc: string; sig?: string; symbol?: string; matchType?: string; confidence?: string },
  content: string,
  options: { full?: boolean } = {},
): void {
  console.log(colors.bold(`\n${target.file}`) + colors.dim(` [${target.loc}]`));
  if (options.full && target.sig) {
    console.log(colors.dim(target.sig));
  }
  if (options.full && (target.matchType || target.confidence)) {
    console.log(colors.dim(`resolved: ${target.symbol ?? target.file} (${target.matchType ?? 'fallback'}, ${target.confidence ?? 'low'})`));
  }
  console.log('');

  const [start] = target.loc.split('-').map(Number);
  const rendered = options.full
    ? formatCompactSnippetLines(content, start)
    : formatBoundedSnippetLines(content, start, DEFAULT_SNIPPET_LINE_LIMIT);
  for (const line of rendered) {
    console.log(line);
  }
}

interface ReadHistory {
  reads: Array<{ file: string; start: number; end: number; at: string }>;
}

function shouldSuppressRepeatedRead(projectRoot: string, file: string, loc: string): boolean {
  const range = parseRange(loc);
  if (!range) {
    return false;
  }

  const history = loadReadHistory(projectRoot);
  return history.reads.some(read =>
    read.file === file
    && read.start <= range.start
    && read.end >= range.end
  );
}

function rememberRead(projectRoot: string, file: string, loc: string): void {
  const range = parseRange(loc);
  if (!range) {
    return;
  }

  const history = loadReadHistory(projectRoot);
  const reads = [
    ...history.reads.filter(read => !(read.file === file && read.start === range.start && read.end === range.end)),
    { file, start: range.start, end: range.end, at: new Date().toISOString() },
  ].slice(-200);
  saveReadHistory(projectRoot, { reads });
}

function loadReadHistory(projectRoot: string): ReadHistory {
  const filePath = path.join(projectRoot, READ_HISTORY_FILE);
  try {
    if (!fs.existsSync(filePath)) {
      return { reads: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ReadHistory>;
    return {
      reads: Array.isArray(parsed.reads)
        ? parsed.reads.filter(isHistoryRead)
        : [],
    };
  } catch {
    return { reads: [] };
  }
}

function saveReadHistory(projectRoot: string, history: ReadHistory): void {
  const filePath = path.join(projectRoot, READ_HISTORY_FILE);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
  } catch {
    // Best-effort agent context cache; never fail the user-facing read.
  }
}

function isHistoryRead(value: unknown): value is ReadHistory['reads'][number] {
  const item = value as Partial<ReadHistory['reads'][number]>;
  const start = item.start;
  const end = item.end;
  return typeof item.file === 'string'
    && Number.isInteger(start)
    && Number.isInteger(end)
    && typeof start === 'number'
    && typeof end === 'number'
    && start > 0
    && end >= start;
}

function renderSymbolCandidates(candidates: SymbolCandidate[]): void {
  for (const line of formatSymbolCandidateLines(candidates)) {
    console.log(line);
  }
}

export function formatSymbolCandidateLines(candidates: SymbolCandidate[], maxCandidates: number = 10): string[] {
  const lines = candidates
    .slice(0, maxCandidates)
    .map(candidate => `${formatSignatureLine(candidate.sig)}[${candidate.loc}]`);
  if (candidates.length > maxCandidates) {
    lines.push(colors.dim('...'));
  }
  return lines;
}

function renderCompactMethods(methods: Array<{ name: string; class?: string; loc: string; sig?: string }>): void {
  for (const line of formatCompactMethodLines(methods, DEFAULT_SUMMARY_LIMIT)) {
    console.log(line);
  }
}

export function formatCompactMethodLines(
  methods: Array<{ name: string; class?: string; loc: string; sig?: string }>,
  maxMethods: number = DEFAULT_SUMMARY_LIMIT,
): string[] {
  const lines: string[] = [];
  let renderedMethods = 0;

  for (const group of groupMethods(methods)) {
    if (renderedMethods >= maxMethods) {
      lines.push(colors.dim('  ...'));
      break;
    }

    if (group.items.length === 1) {
      const method = group.items[0];
      lines.push(`  ${group.label} [${method.loc}]`);
      renderedMethods += 1;
      continue;
    }

    const remaining = maxMethods - renderedMethods;
    const visibleItems = group.items.slice(0, remaining);
    lines.push(`  ${group.label}: [${group.items.length} overload]`);
    for (const method of visibleItems) {
      lines.push(`    ${formatSignatureLine(method.sig)}[${method.loc}]`);
    }
    renderedMethods += visibleItems.length;

    if (visibleItems.length < group.items.length) {
      lines.push(colors.dim('    ...'));
      break;
    }
  }

  return lines;
}

function renderFullMethods(methods: Array<{ name: string; class?: string; loc: string; sig?: string }>, classCount: number): void {
  if (classCount <= 1) {
    for (const method of methods) {
      console.log(`  ${formatSignatureLine(method.sig)}[${method.loc}]`);
    }
    return;
  }

  const groups = new Map<string, Array<{ name: string; class?: string; loc: string; sig?: string }>>();
  for (const method of methods) {
    const className = method.class ?? '(global)';
    groups.set(className, [...(groups.get(className) ?? []), method]);
  }

  for (const [className, items] of groups) {
    console.log(`  ${className}:`);
    for (const method of items) {
      console.log(`    ${formatSignatureLine(method.sig)}[${method.loc}]`);
    }
  }
}

function groupMethods(methods: Array<{ name: string; class?: string; loc: string; sig?: string }>): Array<{
  label: string;
  items: Array<{ name: string; class?: string; loc: string; sig?: string }>;
}> {
  const groups = new Map<string, Array<{ name: string; class?: string; loc: string; sig?: string }>>();
  for (const method of methods) {
    const label = method.class ? `${method.class}.${method.name}` : method.name;
    groups.set(label, [...(groups.get(label) ?? []), method]);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function formatSignatureLine(sig: string | undefined): string {
  if (!sig) {
    return '';
  }

  const start = sig.indexOf('(');
  const end = sig.lastIndexOf(')');
  if (start >= 0 && end > start) {
    const prefix = formatSignaturePrefix(sig.slice(0, start));
    return `${prefix ? `${prefix}` : ''}${sig.slice(start, end + 1)}`;
  }
  return sig;
}

function formatSignaturePrefix(prefix: string): string {
  const modifierSet = new Set([
    'public',
    'private',
    'protected',
    'internal',
    'static',
    'async',
    'virtual',
    'override',
    'abstract',
    'sealed',
    'extern',
    'unsafe',
    'new',
    'partial',
  ]);
  const tokens = prefix
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const modifiers = tokens.filter(token => modifierSet.has(token));
  const name = tokens[tokens.length - 1];
  return [...modifiers, name].filter(Boolean).join(' ');
}

function renderMemories(memories?: Array<{ text: string }>): void {
  if (!memories || memories.length === 0) {
    return;
  }

  console.log('');
  console.log(colors.cyan('File Notes:'));
  for (const memory of memories.slice(0, 3)) {
    console.log(colors.dim(`  - ${memory.text}`));
  }
}

export function formatCompactSnippetLines(content: string, startLine: number): string[] {
  const lines = content.split('\n');
  if (lines.length === 0) {
    return [];
  }

  const endLine = startLine + lines.length - 1;
  const gutterWidth = String(endLine).length;
  if (lines.length <= 2) {
    return lines.map((line, index) => {
      const lineNum = String(startLine + index).padStart(gutterWidth, ' ');
      return `${colors.dim(lineNum + '│')} ${line}`;
    });
  }

  return [
    `${colors.dim(String(startLine).padStart(gutterWidth, ' ') + '│')} ${lines[0]}`,
    ...lines.slice(1, -1),
    `${colors.dim(String(endLine).padStart(gutterWidth, ' ') + '│')} ${lines[lines.length - 1]}`,
  ];
}

export function formatBoundedSnippetLines(content: string, startLine: number, maxLines: number): string[] {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return formatCompactSnippetLines(content, startLine);
  }

  const headCount = Math.max(1, Math.ceil(maxLines * 0.75));
  const tailCount = Math.max(1, maxLines - headCount);
  const head = lines.slice(0, headCount).join('\n');
  const tail = lines.slice(-tailCount).join('\n');
  const omitted = lines.length - headCount - tailCount;
  const tailStart = startLine + lines.length - tailCount;

  return [
    ...formatCompactSnippetLines(head, startLine),
    colors.dim(`... omitted ${omitted} lines; use --full`),
    ...formatCompactSnippetLines(tail, tailStart),
  ];
}
