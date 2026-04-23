import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function openCommand(
  target: string,
  options: { around?: string; class?: boolean; top?: boolean } = {},
): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const resolved = await container.codeReadService.openTarget(target, {
      around: parseAroundOption(options.around, 12),
      classContext: options.class,
      top: options.top,
    });

    console.log(colors.bold(`\n${resolved.target.file}`) + colors.dim(` [${resolved.target.loc}] open`));
    if (resolved.target.sig) {
      console.log(colors.dim(resolved.target.sig));
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
    console.error(colors.red(`Open failed: ${err}`));
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
