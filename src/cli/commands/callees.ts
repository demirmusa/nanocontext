import { Container } from '../../core/Container';
import { colors } from '../utils/colors';
import { printTraceSurface } from '../utils/traceSurface';

export async function calleesCommand(symbol: string): Promise<void> {
  const container = new Container();
  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const surface = await container.dependencyService.getCallees(symbol);
    printTraceSurface(surface, 'No callees found.');
  } catch (err) {
    console.error(colors.red(`Callees failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
