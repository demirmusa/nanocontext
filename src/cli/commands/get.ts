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
        renderResolvedSnippet(resolved.target.file, resolved.target.loc, resolved.snippet.content, resolved.target.sig);
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

    renderResolvedSnippet(snippetResult.target.file, snippetResult.target.loc, snippet.content);
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

function renderResolvedSnippet(filePath: string, loc: string, content: string, sig?: string): void {
  console.log(colors.bold(`\n${filePath}`) + colors.dim(` [${loc}]`));
  if (sig) {
    console.log(colors.dim(sig));
  }
  console.log('');

  const [start] = loc.split('-').map(Number);
  const lines = content.split('\n');
  const gutterWidth = String(start + lines.length - 1).length;

  for (let index = 0; index < lines.length; index++) {
    const lineNum = String(start + index).padStart(gutterWidth, ' ');
    console.log(`${colors.dim(lineNum + '│')} ${lines[index]}`);
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
