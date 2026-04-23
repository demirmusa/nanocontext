import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function peekCommand(target: string): Promise<void> {
  await renderPreview(target, 'peek');
}

async function renderPreview(target: string, mode: 'peek'): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const resolved = await container.codeReadService.peekTarget(target);
    renderResolvedPreview(resolved.target, resolved.snippet.content, mode);
    if (resolved.memories?.length) {
      console.log('');
      console.log(colors.cyan('File Notes:'));
      for (const memory of resolved.memories.slice(0, 3)) {
        console.log(colors.dim(`  - ${memory.text}`));
      }
    }
  } catch (err) {
    console.error(colors.red(`Peek failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function renderResolvedPreview(target: { file: string; loc: string; sig?: string; symbol?: string; matchType?: string; confidence?: string }, content: string, mode?: 'peek'): void {
  const label = mode ? ` ${mode}` : '';
  console.log(colors.bold(`\n${target.file}`) + colors.dim(` [${target.loc}]${label}`));
  if (target.sig) {
    console.log(colors.dim(target.sig));
  }
  if (target.matchType || target.confidence) {
    console.log(colors.dim(`resolved: ${target.symbol ?? target.file} (${target.matchType ?? 'fallback'}, ${target.confidence ?? 'low'})`));
  }
  console.log('');

  const [start] = target.loc.split('-').map(Number);
  const lines = content.split('\n');
  const gutterWidth = String(start + lines.length - 1).length;

  for (let index = 0; index < lines.length; index++) {
    const lineNum = String(start + index).padStart(gutterWidth, ' ');
    console.log(`${colors.dim(lineNum + '│')} ${lines[index]}`);
  }
}
