import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function getCommand(target: string): Promise<void> {
  const match = target.match(/^(.+)\[(\d+)-(\d+)\]$/);
  if (!match) {
    console.error(colors.red('Usage: nc get <file>[<start>-<end>]'));
    console.error(colors.dim('Example: nc get myfile.cs[76-89]'));
    process.exit(1);
  }

  const [, filePath, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  const container = new Container();

  if (start > end || start < 1) {
    console.error(colors.red(`Invalid line range: ${start}-${end}`));
    process.exit(1);
  }

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const snippet = container.codeReadService.readSnippet(filePath, `${start}-${end}`);

    if (snippet.error) {
      console.error(colors.red(snippet.error));
      process.exit(1);
    }

    if (snippet.warning) {
      console.warn(colors.yellow(snippet.warning));
    }

    const lines = snippet.content.split('\n');
    const gutterWidth = String(start + lines.length - 1).length;

    for (let index = 0; index < lines.length; index++) {
      const lineNum = String(start + index).padStart(gutterWidth, ' ');
      console.log(`${colors.dim(lineNum + '│')} ${lines[index]}`);
    }
  } catch (err) {
    console.error(colors.red(`Get failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
