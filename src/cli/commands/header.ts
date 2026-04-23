import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function headerCommand(file: string): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    const summary = await container.codeReadService.readFileSummary(file);

    if (summary.error) {
      console.error(colors.red(summary.error));
      process.exit(1);
    }

    console.log(colors.bold(`\n${summary.file}`) + colors.dim(` [${summary.totalLines} lines]\n`));
    console.log(colors.dim(`Imports: ${summary.importCount}`));
    if (summary.imports.length > 0) {
      console.log(colors.dim(`  ${summary.imports.join(', ')}`));
    }
    console.log('');

    if (summary.classes.length > 0) {
      console.log(colors.cyan('Classes:'));
      for (const cls of summary.classes) {
        console.log(`  ${cls.name} [${cls.loc}]`);
      }
      console.log('');
    }

    if (summary.methods.length > 0) {
      console.log(colors.cyan('Methods:'));
      for (const method of summary.methods) {
        const owner = method.class ? `${method.class}.` : '';
        console.log(`  ${owner}${method.name} [${method.loc}]`);
        if (method.sig) {
          console.log(colors.dim(`    ${method.sig}`));
        }
      }
      console.log('');
    }

    if (summary.warning) {
      console.log(colors.yellow(summary.warning));
    }
    if (summary.memories?.length) {
      console.log(colors.cyan('File Notes:'));
      for (const memory of summary.memories.slice(0, 3)) {
        console.log(colors.dim(`  - ${memory.text}`));
      }
    }
  } catch (err) {
    console.error(colors.red(`Header failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
