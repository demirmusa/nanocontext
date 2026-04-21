import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function statusCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const status = await container.statusService.getStatus();

    console.log(colors.bold('\nNanoContext Status\n'));
    console.log(`  Files indexed:     ${colors.cyan(String(status.totalFiles))}`);
    console.log(`  Methods:           ${colors.cyan(String(status.totalMethods))}`);
    console.log(`  Vectors:           ${colors.cyan(String(status.vectorCount))}`);
    console.log(`  Insight queue:     ${colors.cyan(String(status.pendingInsights))}`);
    console.log(`  AI Insight:        ${status.aiInsight ? colors.green('enabled') : colors.dim('disabled')}`);
    console.log(`  Languages:         ${status.languages.join(', ') || colors.dim('auto')}`);
    console.log(`  Last scan:         ${status.lastScanAt || colors.dim('never')}`);
    console.log('');
  } catch (err) {
    console.error(colors.red(`Status failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
