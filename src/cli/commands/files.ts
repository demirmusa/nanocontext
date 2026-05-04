import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function filesCommand(query: string | undefined, options: { query?: string[] } = {}): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const queries = collectFileQueries(query, options.query);
    const batches = queries.length > 0 ? queries : [undefined];

    for (const [index, currentQuery] of batches.entries()) {
      const files = container.fileDiscoveryService.list(currentQuery);
      if (batches.length > 1) {
        if (index > 0) {
          console.log('');
        }
        console.log(colors.bold(`Query: ${currentQuery}`));
      }

      if (files.length === 0) {
        console.log(colors.dim(currentQuery ? 'No indexed files found.' : 'No indexed files.'));
        continue;
      }

      for (const file of files) {
        console.log(file);
      }
    }
  } catch (err) {
    console.error(colors.red(`Files failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

export function collectFileQueries(query: string | undefined, batchQueries?: string[]): string[] {
  const values = [
    ...(query ? [query] : []),
    ...(batchQueries ?? []),
  ].flatMap(item => item.split('|'))
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}
