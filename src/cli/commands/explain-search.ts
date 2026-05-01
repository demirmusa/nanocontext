import { Container } from '../../core/Container';
import { SearchFormatter } from '../../core/search/SearchFormatter';
import { colors } from '../utils/colors';

export async function explainSearchCommand(query: string, options: { limit?: string; vector?: boolean; regex?: boolean }): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const limit = parseInt(options.limit || '5', 10);
    const results = await container.searchService.execute({
      mode: options.regex ? 'regex' : options.vector ? 'vector' : 'exact',
      query,
      limit,
      deep: true,
      typeFilter: options.vector ? 'all' : undefined,
    });

    console.log(SearchFormatter.formatExplain(query, results));
  } catch (err) {
    console.error(colors.red(`Explain search failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
