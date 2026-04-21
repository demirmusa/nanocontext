import { Container } from '../../core/Container';
import { SearchFormatter } from '../../core/search/SearchFormatter';
import { colors } from '../utils/colors';

export async function searchCommand(query: string, options: { deep?: boolean; exact?: boolean; vector?: boolean; regex?: boolean; limit?: string }): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const limit = parseInt(options.limit || '3', 10);

    if (options.regex) {
      const results = await container.searchService.execute({
        mode: 'regex',
        query,
        limit,
        deep: options.deep,
      });
      console.log(options.deep ? SearchFormatter.formatDetailed(results) : SearchFormatter.formatCompact(results));
    } else if (options.vector) {
      const results = await container.searchService.execute({
        mode: 'vector',
        query,
        limit,
        deep: options.deep,
        typeFilter: 'all',
      });
      console.log(options.deep ? SearchFormatter.formatDetailed(results) : SearchFormatter.formatCompact(results));
    } else {
      const results = await container.searchService.execute({
        mode: 'exact',
        query,
        limit,
        deep: options.deep,
      });
      console.log(options.deep ? SearchFormatter.formatDetailed(results) : SearchFormatter.formatCompact(results));
    }
  } catch (err) {
    console.error(colors.red(`Search failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
