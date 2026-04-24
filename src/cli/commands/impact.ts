import { Container } from '../../core/Container';
import { ImpactReport, TestCandidate } from '../../core/services/ImpactService';
import { MemoryRecord, TraceRelation } from '../../core/interfaces/types';
import { colors } from '../utils/colors';

export async function impactCommand(target: string): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    printImpactReport(await container.impactService.analyze(target));
  } catch (err) {
    console.error(colors.red(`Impact failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function printImpactReport(report: ImpactReport): void {
  console.log(colors.bold('\nImpact\n'));

  if (report.target) {
    const label = report.target.symbol || report.target.file;
    const range = report.target.range ? ` [${report.target.range}]` : '';
    console.log(`${colors.cyan(label)} ${colors.dim(`${report.target.file}${range}`)}`);
  } else {
    console.log(colors.cyan(report.query));
  }

  printRelations('Callers', report.callers);
  printRelations('Callees', report.callees);
  printRelations('Trace', report.trace);
  printRelations('Same file symbols', report.sameFileSymbols);
  printTests(report.possibleTests);
  printMemories(report.memories);

  if (report.warnings.length > 0) {
    console.log('');
    console.log(colors.dim('Warnings:'));
    for (const warning of report.warnings) {
      console.log(colors.dim(`  ${warning}`));
    }
  }

  if (report.suggestedNext.length > 0) {
    console.log('');
    console.log(colors.dim('Next:'));
    for (const next of report.suggestedNext) {
      console.log(colors.dim(`  ${next}`));
    }
  }
}

function printRelations(title: string, relations: TraceRelation[]): void {
  console.log('');
  console.log(colors.bold(title));
  if (relations.length === 0) {
    console.log(colors.dim('  none'));
    return;
  }

  for (const relation of relations) {
    const reason = relation.reason ? colors.dim(` ${relation.reason}`) : '';
    console.log(`  ${relation.symbol} ${colors.dim(`${relation.path} [${relation.range}] (${relation.confidence})`)}${reason}`);
  }
}

function printTests(tests: TestCandidate[]): void {
  console.log('');
  console.log(colors.bold('Possible tests'));
  if (tests.length === 0) {
    console.log(colors.dim('  none'));
    return;
  }

  for (const test of tests) {
    console.log(`  ${test.file} ${colors.dim(`(${test.confidence}) ${test.reason}`)}`);
  }
}

function printMemories(memories: MemoryRecord[]): void {
  console.log('');
  console.log(colors.bold('Memory'));
  if (memories.length === 0) {
    console.log(colors.dim('  none'));
    return;
  }

  for (const memory of memories.slice(0, 8)) {
    const scope = memory.symbol || memory.file || memory.ref || memory.scope || 'project';
    console.log(`  ${memory.text} ${colors.dim(`[${scope}]`)}`);
  }
}
