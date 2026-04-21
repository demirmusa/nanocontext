import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

export async function inspectCommand(file: string): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const { file: normalizedFile, header } = await container.inspectionService.inspect(file);
    if (!header) {
      console.log(colors.yellow(`No header found for: ${normalizedFile}`));
      console.log(colors.dim('Run `nc scan -f ' + normalizedFile + '` to generate it.'));
      return;
    }

    console.log(colors.bold(`\n${header.file}`) + colors.dim(` [${header.lang}] checksum:${header.checksum}\n`));

    if (header.classes.length > 0) {
      console.log(colors.cyan('Classes:'));
      for (const cls of header.classes) {
        const ext = cls.extends ? ` extends ${cls.extends}` : '';
        const impl = cls.implements?.length ? ` implements ${cls.implements.join(', ')}` : '';
        console.log(`  ${cls.name}${ext}${impl} [${cls.loc}]`);
        if (cls.insight) console.log(colors.dim(`    → ${cls.insight}`));
      }
      console.log('');
    }

    if (header.methods.length > 0) {
      console.log(colors.cyan('Methods:'));
      for (const m of header.methods) {
        const cls = m.class ? `${m.class}.` : '';
        console.log(`  ${cls}${m.name} [${m.loc}]`);
        console.log(colors.dim(`    ${m.sig}`));
        if (m.refs.length > 0) console.log(colors.dim(`    refs: ${m.refs.join(', ')}`));
        if (m.decorators?.length) console.log(colors.dim(`    decorators: ${m.decorators.join(', ')}`));
        if (m.insight) console.log(colors.dim(`    → ${m.insight}`));
      }
      console.log('');
    }

    if (header.imports.length > 0) {
      console.log(colors.dim(`Imports: ${header.imports.join(', ')}`));
    }
    if (header.exports.length > 0) {
      console.log(colors.dim(`Exports: ${header.exports.join(', ')}`));
    }
  } catch (err) {
    console.error(colors.red(`Inspect failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}
