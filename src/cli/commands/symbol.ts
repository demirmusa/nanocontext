import { Container } from '../../core/Container';
import { colors } from '../utils/colors';
import { printSymbolResolution } from '../utils/symbolResolution';

export async function symbolCommand(query: string | undefined, options: { query?: string[] } = {}): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const queries = collectQueries(query, options.query);
    if (queries.length === 0) {
      console.error(colors.red('Provide a symbol query or repeat `--query`.'));
      process.exit(1);
    }

    for (const [index, currentQuery] of queries.entries()) {
      const resolution = await container.codeReadService.resolveSymbolTarget(currentQuery);
      if (queries.length > 1) {
        if (index > 0) {
          console.log('');
        }
        console.log(colors.bold(`Query: ${currentQuery}`));
      }
      printSymbolResolution(resolution);
    }
  } catch (err) {
    console.error(colors.red(`Symbol failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function collectQueries(query: string | undefined, batchQueries?: string[]): string[] {
  const values = [
    ...(query ? [query] : []),
    ...(batchQueries ?? []),
  ].map(item => item.trim()).filter(Boolean);
  return [...new Set(values)];
}
