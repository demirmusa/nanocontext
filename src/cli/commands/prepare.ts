import { Container } from '../../core/Container';
import { formatPrepareReport } from '../../core/services/PrepareService';
import { colors } from '../utils/colors';

export async function prepareCommand(task: string, options: { limit?: string; json?: boolean } = {}): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const limit = Math.max(1, Math.min(parseInt(options.limit || '5', 10), 10));
    const report = await container.prepareService.prepare(task, limit);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatPrepareReport(report));
  } catch (err) {
    console.error(colors.red(`Prepare failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
