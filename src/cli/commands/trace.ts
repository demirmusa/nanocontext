import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function traceCommand(symbol: string, options: { depth?: string } = {}): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const steps = await container.dependencyService.traceSymbol(symbol, parseDepth(options.depth));
    if (steps.length === 0) {
      console.log(colors.dim('No trace found.'));
      return;
    }
    for (const step of steps) {
      console.log(`${step.file}  ${step.symbol}${step.loc ? ` [${step.loc}]` : ''}`);
      if (step.refs.length > 0) {
        console.log(colors.dim(`  refs: ${step.refs.join(', ')}`));
      }
    }
  } catch (err) {
    console.error(colors.red(`Trace failed: ${err}`));
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
