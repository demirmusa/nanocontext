import { Container } from '../../core/Container';
import { StaleIssue, StaleReport } from '../../core/services/StaleService';
import { colors } from '../utils/colors';

export async function staleCommand(): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    printStaleReport(await container.staleService.inspect());
  } catch (err) {
    console.error(colors.red(`Stale check failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function printStaleReport(report: StaleReport): void {
  console.log(colors.bold('\nStale Check\n'));
  console.log(`  Tracked files:     ${colors.cyan(String(report.stats.trackedFiles))}`);
  console.log(`  Changed files:     ${severityCount(report.stats.changedFiles)}`);
  console.log(`  Missing files:     ${severityCount(report.stats.missingFiles)}`);
  console.log(`  Missing headers:   ${severityCount(report.stats.missingHeaders)}`);
  console.log(`  Insight queue:     ${colors.cyan(String(report.stats.pendingInsights))}`);
  console.log(`  Vectors/methods:   ${colors.cyan(`${report.stats.vectorCount}/${report.stats.totalMethods}`)}`);

  console.log('');
  if (report.ok) {
    console.log(colors.green('✓ Index looks fresh.'));
  } else {
    console.log(colors.yellow('Issues:'));
    for (const issue of report.issues) {
      console.log(renderIssue(issue));
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

function severityCount(count: number): string {
  return count > 0 ? colors.yellow(String(count)) : colors.cyan('0');
}

function renderIssue(issue: StaleIssue): string {
  const subject = issue.file ? `${issue.file}: ` : '';
  const color = issue.severity === 'high' ? colors.red : issue.severity === 'medium' ? colors.yellow : colors.dim;
  return `  ${color(issue.kind)} ${subject}${colors.dim(issue.detail)}`;
}
