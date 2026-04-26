import { Container } from '../../core/Container';
import { ResolvedSymbolSnippetResult } from '../../core/services/CodeReadService';
import { colors } from '../utils/colors';

export async function openCommand(
  target: string,
  options: { around?: string; class?: boolean; top?: boolean } = {},
): Promise<void> {
  const container = new Container();
  const rangeMatch = target.match(/^(.+)\[(\d+)-(\d+)\]$/);

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const resolved = rangeMatch
      ? await readExplicitRange(container, rangeMatch, options)
      : await container.codeReadService.openTarget(target, {
        around: parseAroundOption(options.around, 12),
        classContext: options.class,
        top: options.top,
      });

    if (resolved.snippet.error) {
      throw new Error(resolved.snippet.error);
    }
    if (resolved.snippet.warning) {
      console.warn(colors.yellow(resolved.snippet.warning));
    }

    console.log(colors.bold(`\n${resolved.target.file}`) + colors.dim(` [${resolved.target.loc}] open`));
    if (resolved.target.sig) {
      console.log(colors.dim(resolved.target.sig));
    }
    if (resolved.target.matchType || resolved.target.confidence) {
      console.log(colors.dim(`resolved: ${resolved.target.symbol} (${resolved.target.matchType ?? 'fallback'}, ${resolved.target.confidence ?? 'low'})`));
    }
    console.log('');

    const [start] = resolved.target.loc.split('-').map(Number);
    const lines = resolved.snippet.content.split('\n');
    const gutterWidth = String(start + lines.length - 1).length;

    for (let index = 0; index < lines.length; index++) {
      const lineNum = String(start + index).padStart(gutterWidth, ' ');
      console.log(`${colors.dim(lineNum + '│')} ${lines[index]}`);
    }
    if (resolved.memories?.length) {
      console.log('');
      console.log(colors.cyan('File Notes:'));
      for (const memory of resolved.memories.slice(0, 3)) {
        console.log(colors.dim(`  - ${memory.text}`));
      }
    }
  } catch (err) {
    const message = String(err);
    if (message.includes('No symbol match found')) {
      console.error(colors.red(`${message} Try \`nc files "${target}"\` or \`nc symbol "${target}"\`.`));
    } else {
      console.error(colors.red(`Open failed: ${err}`));
    }
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

async function readExplicitRange(
  container: Container,
  match: RegExpMatchArray,
  options: { around?: string },
): Promise<ResolvedSymbolSnippetResult> {
  const [, filePath, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  if (start > end || start < 1) {
    throw new Error(`Invalid line range: ${start}-${end}`);
  }

  const loc = `${start}-${end}`;
  const around = parseAroundOption(options.around, 0);
  return around > 0
    ? container.codeReadService.readSnippetAround(filePath, loc, around)
    : {
      target: { file: filePath, symbol: filePath, loc, type: 'class' },
      snippet: container.codeReadService.readSnippet(filePath, loc),
    };
}
