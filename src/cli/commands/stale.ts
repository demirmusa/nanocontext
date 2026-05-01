import { Container } from '../../core/Container';
import { StaleIssue, StaleReport } from '../../core/services/StaleService';
import { colors } from '../utils/colors';

export async function staleCommand(options: { compact?: boolean } = {}): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();
    printStaleReport(await container.staleService.inspect(), options.compact ?? false);
  } catch (err) {
    console.error(colors.red(`Stale check failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function printStaleReport(report: StaleReport, compact: boolean = false): void {
  if (compact) {
    printCompactReport(report);
    return;
  }

  console.log(colors.bold('\nStale Check\n'));
  console.log(`  Tracked files:     ${colors.cyan(String(report.stats.trackedFiles))}`);
  console.log(`  Changed files:     ${severityCount(report.stats.changedFiles)}`);
  console.log(`  Missing files:     ${severityCount(report.stats.missingFiles)}`);
  console.log(`  Missing headers:   ${severityCount(report.stats.missingHeaders)}`);
  console.log(`  Parser issues:     ${severityCount(report.stats.parseFailures + report.stats.unsupportedFiles)}`);
  console.log(`  Insight queue:     ${colors.cyan(`${report.stats.pendingInsights} pending, ${report.stats.staleInsights} stale`)}`);
  console.log(`  Vectors/symbols:   ${colors.cyan(`${report.stats.vectorCount}/${report.stats.totalSymbols}`)}`);
  console.log(`  Generation issues: ${severityCount(report.stats.generationMismatches)}`);
  console.log(`  Last scan:         ${colors.cyan(report.stats.lastScanAt ?? 'unknown')}`);

  console.log('');
  if (report.ok) {
    console.log(colors.green('✓ Index looks fresh.'));
  } else {
    console.log(colors.yellow('Issues:'));
    for (const [category, issues] of Object.entries(report.categories)) {
      console.log(colors.bold(`  ${category}`));
      for (const issue of issues.slice(0, 20)) {
        console.log(renderIssue(issue));
      }
      if (issues.length > 20) {
        console.log(colors.dim(`    ... ${issues.length - 20} more`));
      }
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

function printCompactReport(report: StaleReport): void {
  const status = report.ok ? 'ok' : 'issues';
  console.log(`status=${status} tracked=${report.stats.trackedFiles} changed=${report.stats.changedFiles} missing=${report.stats.missingFiles} headers=${report.stats.missingHeaders} vectors=${report.stats.vectorCount}/${report.stats.totalSymbols} generationIssues=${report.stats.generationMismatches} pendingInsights=${report.stats.pendingInsights} staleInsights=${report.stats.staleInsights}`);
  for (const issue of report.issues.slice(0, 30)) {
    const subject = issue.symbol ? `${issue.file ?? ''}#${issue.symbol}` : issue.file ?? '-';
    console.log(`${issue.severity} ${issue.category}/${issue.kind} ${subject} action="${issue.action}" detail="${issue.detail}"`);
  }
  if (report.issues.length > 30) {
    console.log(`more=${report.issues.length - 30}`);
  }
  if (report.suggestedNext.length > 0) {
    console.log(`next=${report.suggestedNext.join(' | ')}`);
  }
}

function severityCount(count: number): string {
  return count > 0 ? colors.yellow(String(count)) : colors.cyan('0');
}

function renderIssue(issue: StaleIssue): string {
  const symbol = issue.symbol ? `#${issue.symbol}` : '';
  const subject = issue.file ? `${issue.file}${symbol}: ` : '';
  const color = issue.severity === 'high' ? colors.red : issue.severity === 'medium' ? colors.yellow : colors.dim;
  return `    ${color(issue.kind)} ${subject}${colors.dim(`${issue.detail} -> ${issue.action}`)}`;
}
