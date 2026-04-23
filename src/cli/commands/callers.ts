import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function callersCommand(symbol: string): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const callers = await container.dependencyService.getCallers(symbol);
    if (callers.length === 0) {
      console.log(colors.dim('No callers found.'));
      return;
    }
    for (const caller of callers) {
      console.log(`${caller.file}  ${caller.method} [${caller.loc}]`);
    }
  } catch (err) {
    console.error(colors.red(`Callers failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
