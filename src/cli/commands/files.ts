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
    const queries = collectQueries(query, options.query);
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

      if (files.length === 1) {
        console.log(colors.dim(`next: nc open ${files[0]}`));
      }
    }
  } catch (err) {
    console.error(colors.red(`Files failed: ${err}`));
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
