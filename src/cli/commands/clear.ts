import { confirm } from '@inquirer/prompts';
import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function clearCommand(target: string): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  const valid = ['all', 'headers', 'vectors'];
  if (!valid.includes(target)) {
    console.log(colors.red(`Invalid target: ${target}. Use: ${valid.join(', ')}`));
    process.exit(1);
  }

  const confirmed = await confirm({
    message: `Clear ${target === 'all' ? 'all data (headers + vectors + state)' : target}?`,
    default: false,
  });

  if (!confirmed) {
    console.log(colors.dim('Cancelled.'));
    return;
  }

  try {
    await container.initialize();
    const result = await container.projectDataService.clear(target as 'all' | 'headers' | 'vectors');

    if (result.clearedHeaders) {
      console.log(colors.green('✓ Headers cleared.'));
    }
    if (result.clearedVectors) {
      console.log(colors.green('✓ Vectors cleared.'));
    }
    if (result.clearedState) {
      console.log(colors.green('✓ State cleared.'));
    }

    console.log(colors.dim('\nRun `nc scan` to rebuild.'));
  } catch (err) {
    console.error(colors.red(`Clear failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
