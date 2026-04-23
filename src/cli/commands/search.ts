import { Container } from '../../core/Container';
import { SearchFormatter } from '../../core/search/SearchFormatter';
import { colors } from '../utils/colors';

export async function searchCommand(query: string | undefined, options: { query?: string[]; deep?: boolean; exact?: boolean; vector?: boolean; regex?: boolean; limit?: string }): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const limit = parseInt(options.limit || '3', 10);
    const queries = collectQueries(query, options.query);
    if (queries.length === 0) {
      console.error(colors.red('Provide a query or repeat `--query`.'));
      process.exit(1);
    }

    for (const [index, currentQuery] of queries.entries()) {
      const results = await container.searchService.execute({
        mode: options.regex ? 'regex' : options.vector ? 'vector' : 'exact',
        query: currentQuery,
        limit,
        deep: options.deep,
        typeFilter: options.vector ? 'all' : undefined,
      });
      if (queries.length > 1) {
        if (index > 0) {
          console.log('');
        }
        console.log(colors.bold(`Query: ${currentQuery}`));
      }
      console.log(options.deep ? SearchFormatter.formatDetailed(results) : SearchFormatter.formatCompact(results));
    }
  } catch (err) {
    console.error(colors.red(`Search failed: ${err}`));
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
