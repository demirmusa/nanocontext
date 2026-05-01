import { Container } from '../../core/Container';
import { colors } from '../utils/colors';
import { printStateReferences } from './state-refs';

export async function refsCommand(symbol: string, options: { depth?: string; state?: boolean } = {}): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    if (options.state) {
      const refs = await container.dependencyService.getStateReferences(symbol);
      printStateReferences(refs, 'No state references found.');
      return;
    }

    const refs = await container.dependencyService.getRefsForSymbol(symbol, parseDepth(options.depth));
    if (refs.length === 0) {
      console.log(colors.dim('No refs found.'));
      return;
    }
    for (const ref of refs) {
      console.log(ref);
    }
  } catch (err) {
    console.error(colors.red(`Refs failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function parseDepth(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
