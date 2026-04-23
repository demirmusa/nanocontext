import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function getCommand(target: string, options: { around?: string } = {}): Promise<void> {
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
        renderResolvedSnippet(resolved.target, resolved.snippet.content);
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

      console.log(colors.bold(`\n${summary.file}`) + colors.dim(` [${summary.totalLines} lines]\n`));
      console.log(colors.dim(`Imports: ${summary.importCount}`));

      if (summary.imports.length > 0) {
        console.log(colors.dim(`  ${summary.imports.join(', ')}`));
      }

      console.log('');

      if (summary.classes.length > 0) {
        console.log(colors.cyan('Classes:'));
        for (const cls of summary.classes) {
          console.log(`  ${cls.name} [${cls.loc}]`);
        }
        console.log('');
      }

      if (summary.methods.length > 0) {
        console.log(colors.cyan('Methods:'));
        for (const method of summary.methods) {
          const owner = method.class ? `${method.class}.` : '';
          console.log(`  ${owner}${method.name} [${method.loc}]`);
          if (method.sig) {
            console.log(colors.dim(`    ${method.sig}`));
          }
        }
        console.log('');
      }

      if (summary.warning) {
        console.log(colors.yellow(summary.warning));
      }
      renderMemories(summary.memories);

      console.log(colors.dim('Tip: use `nc get <file>[start-end]` to open raw lines.'));
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

    renderResolvedSnippet(snippetResult.target, snippet.content);
  } catch (err) {
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

function renderResolvedSnippet(target: { file: string; loc: string; sig?: string; symbol?: string; matchType?: string; confidence?: string }, content: string): void {
  console.log(colors.bold(`\n${target.file}`) + colors.dim(` [${target.loc}]`));
  if (target.sig) {
    console.log(colors.dim(target.sig));
  }
  if (target.matchType || target.confidence) {
    console.log(colors.dim(`resolved: ${target.symbol ?? target.file} (${target.matchType ?? 'fallback'}, ${target.confidence ?? 'low'})`));
  }
  console.log('');

  const [start] = target.loc.split('-').map(Number);
  for (const line of formatCompactSnippetLines(content, start)) {
    console.log(line);
  }
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
