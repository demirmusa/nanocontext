import * as fs from 'fs';
import * as path from 'path';
import { Container } from '../../core/Container';
import { colors } from '../utils/colors';
import { ScanProgress } from '../../core/interfaces/types';
import { IndexRuntimeConfigSummary } from '../../core/services/IndexService';

class ScanDisplay {
  private logPath: string;
  private changedCount = 0;
  private skippedCount = 0;
  private lastFile = '';
  private lastStatusLine = '';
  private scanStart: Date;

  constructor(projectRoot: string) {
    const logDir = path.join(projectRoot, '.nanocontext', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this.scanStart = new Date();
    const ts = this.scanStart.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.logPath = path.join(logDir, `scan-${ts}.log`);
    fs.writeFileSync(this.logPath, `[SCAN START] ${this.scanStart.toISOString()}\n`, 'utf-8');
  }

  /** Append a line to the log file */
  log(line: string): void {
    fs.appendFileSync(this.logPath, line + '\n');
  }

  /** Print a status string only when it changes */
  status(text: string): void {
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    if (plain === this.lastStatusLine) {
      return;
    }

    this.lastStatusLine = plain;
    console.log(text);
  }

  /** Print a permanent line */
  printLine(text: string): void {
    this.lastStatusLine = '';
    console.log(text);
  }

  trackFile(file: string, skipped: boolean): void {
    if (file === this.lastFile) return;
    this.lastFile = file;
    if (skipped) {
      this.skippedCount++;
    } else {
      this.changedCount++;
      this.log(`[STRUCTURE] changed: ${file}`);
    }
  }

  resetCounts(): void {
    this.changedCount = 0;
    this.skippedCount = 0;
    this.lastFile = '';
  }

  finalize(): void {
    const elapsed = ((Date.now() - this.scanStart.getTime()) / 1000).toFixed(1);
    this.log(`[SCAN END] ${new Date().toISOString()} (${elapsed}s)`);
  }

  getChangedCount(): number { return this.changedCount; }
  getSkippedCount(): number { return this.skippedCount; }
  getLogPath(): string { return this.logPath; }
  getTotalChanged(): number { return this.changedCount; }
}

export async function scanCommand(options: { resume?: boolean; rebuildVectors?: boolean; verbose?: boolean; file?: string[] }): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    // If specific files given, sync those and return
    if (options.file && options.file.length > 0) {
      await container.initialize();
      const results = await container.indexService.scanFiles(options.file);
      for (const r of results) {
        console.log(
          `${colors.cyan(r.file)} synced. ${r.methodsUpdated} updated, ${r.methodsAdded} added, ${r.methodsRemoved} removed.`,
        );
      }
      if (results.length === 0) {
        console.log(colors.yellow('No matching files found.'));
      }
      return;
    }

    if (container.indexService.isWatchRunning()) {
      console.log(colors.yellow('Watch mode is active — files are auto-indexed on save. No scan needed.'));
      await container.dispose();
      return;
    }

    await container.initialize();

    if (options.rebuildVectors) {
      console.log(colors.bold('Rebuilding vectors from existing headers...\n'));
      await container.indexService.rebuildVectors();
      console.log(colors.green('✓ Vectors cleared.\n'));
    }

    if (options.resume) {
      console.log(colors.dim('Resuming: skipping files with unchanged checksums.\n'));
    }

    console.log(colors.bold('Scanning project...\n'));

    const verbose = !!options.verbose;
    const display = new ScanDisplay(container.indexService.getProjectRoot());
    let currentPhase = '';
    let phaseSnapshot: ScanProgress | null = null;
    let insightSuccessCount = 0;
    let insightErrorCount = 0;

    const runtimeConfig = await container.indexService.getRuntimeConfigSummary();

    const phaseLabels: Record<string, string> = {
      structure: 'Structure',
      insight: `AI Insight [${runtimeConfig.llmProvider} ${runtimeConfig.llmModel}]`,
      vectors: `Vectors [${runtimeConfig.embeddingProvider} ${runtimeConfig.embeddingModel}]`,
    };

    if (verbose) {
      display.log(`[CONFIG] resume=${!!options.resume} rebuildVectors=${!!options.rebuildVectors} verbose=true`);
      display.log(`[CONFIG] aiInsight=${runtimeConfig.aiInsight}`);
      display.log(`[CONFIG] llm.provider=${runtimeConfig.llmProvider} llm.model=${runtimeConfig.llmModel}`);
      display.log(`[CONFIG] embedding.provider=${runtimeConfig.embeddingProvider} embedding.model=${runtimeConfig.embeddingModel}`);
    }

    const stats = await container.indexService.scanProject((progress: ScanProgress) => {
      // Phase transition — print summary of previous phase
      if (progress.phase !== currentPhase) {
        if (currentPhase && phaseSnapshot) {
          display.printLine(phaseSummary(currentPhase, phaseSnapshot, display, runtimeConfig));
          if (verbose) {
            display.log(`[PHASE END] ${currentPhase} — ${phaseSnapshot.processedFiles}/${phaseSnapshot.totalFiles} files`);
          }
        }
        currentPhase = progress.phase;
        display.resetCounts();
        if (verbose) {
          display.log(`[PHASE START] ${progress.phase}`);
        }
      }
      phaseSnapshot = { ...progress };

      // Track file (deduplicates internally)
      if (progress.currentFile) {
        display.trackFile(progress.currentFile, !!progress.skipped);
      }

      // Log insight results
      if (progress.insightResult) {
        const ir = progress.insightResult;
        if (ir.error) {
          insightErrorCount++;
          display.log(`[INSIGHT ERROR] ${ir.file} (sent ${ir.sentCount} methods): ${ir.error}`);
          if (ir.prompt) display.log(`[INSIGHT PROMPT] ${ir.file}\n${ir.prompt}`);
          if (ir.rawStdout) display.log(`[INSIGHT RAW STDOUT] ${ir.file}\n${ir.rawStdout}`);
          display.printLine(colors.red(`  [insight error] ${ir.file}: ${ir.error}`));
          if (verbose) {
            if (ir.prompt) display.printLine(colors.dim(`  [prompt →]\n${ir.prompt}`));
            if (ir.rawStdout) display.printLine(colors.dim(`  [raw stdout →]\n${ir.rawStdout}`));
          }
        } else if (ir.methods.length > 0) {
          insightSuccessCount++;
          display.log(`[INSIGHT OK] ${ir.file} — sent ${ir.sentCount} methods, got ${ir.methods.length} results`);
          if (ir.prompt) display.log(`[INSIGHT PROMPT] ${ir.file}\n${ir.prompt}`);
          if (ir.rawStdout) display.log(`[INSIGHT RAW STDOUT] ${ir.file}\n${ir.rawStdout}`);
          if (ir.rawResponse) display.log(`[INSIGHT PARSED] ${ir.file}\n${ir.rawResponse}`);
          if (verbose) {
            display.printLine(colors.dim(`  [insight ok] ${ir.file} → ${ir.methods.map(m => m.name).join(', ')}`));
            if (ir.prompt) display.printLine(colors.dim(`  [prompt →]\n${ir.prompt}`));
            if (ir.rawStdout) display.printLine(colors.dim(`  [raw stdout →]\n${ir.rawStdout}`));
            if (ir.rawResponse) display.printLine(colors.dim(`  [parsed →] ${ir.rawResponse}`));
          }
        } else {
          insightErrorCount++;
          display.log(`[INSIGHT EMPTY] ${ir.file} — sent ${ir.sentCount} methods, got 0 results`);
          if (ir.prompt) display.log(`[INSIGHT PROMPT] ${ir.file}\n${ir.prompt}`);
          if (ir.rawStdout) display.log(`[INSIGHT RAW STDOUT] ${ir.file}\n${ir.rawStdout}`);
          if (verbose) {
            display.printLine(colors.yellow(`  [insight empty] ${ir.file} (${ir.sentCount} methods sent)`));
            if (ir.prompt) display.printLine(colors.dim(`  [prompt →]\n${ir.prompt}`));
            if (ir.rawStdout) display.printLine(colors.dim(`  [raw stdout →]\n${ir.rawStdout}`));
          }
        }
        // skip redundant bare status update when insight result is being reported
        return;
      }

      // Build single-line status
      const label = phaseLabels[progress.phase] || progress.phase;
      let line = `${colors.cyan(`${label}:`)} ${progress.processedFiles}/${progress.totalFiles}`;

      if (progress.phase === 'structure') {
        const changed = display.getChangedCount();
        line += ` | ${colors.yellow(`${changed} changed`)} | ${progress.totalMethods} methods`;
      }

      if (progress.currentFile) {
        line += ` ${colors.dim('→')} ${colors.dim(progress.currentFile)}`;
      }

      display.status(line);
    });

    // Final phase summary
    if (currentPhase && phaseSnapshot) {
      display.printLine(phaseSummary(currentPhase, phaseSnapshot, display, runtimeConfig));
    }

    console.log('');
    console.log(colors.green('✓ Scan complete.'));

    console.log(colors.dim(`  Files: ${stats.totalFiles} | Methods: ${stats.totalMethods}`));
    const cacheStats = container.indexService.getEmbeddingCacheStats();
    if (cacheStats) {
      console.log(colors.dim(`  Embedding cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses, ${cacheStats.writes} writes, ${cacheStats.errors} errors`));
    }
    const providerStats = container.indexService.getEmbeddingProviderGuardStats();
    if (providerStats && (providerStats.retries > 0 || providerStats.failures > 0 || providerStats.timeouts > 0 || providerStats.rateLimits > 0)) {
      console.log(colors.dim(`  Provider guard: ${providerStats.retries} retries, ${providerStats.failures} failures, ${providerStats.rateLimits} rate limits, ${providerStats.timeouts} timeouts`));
    }

    if (verbose) {
      display.log(`[SUMMARY] files=${stats.totalFiles} methods=${stats.totalMethods} insightOK=${insightSuccessCount} insightErrors=${insightErrorCount}`);
      if (cacheStats) {
        display.log(`[EMBEDDING CACHE] hits=${cacheStats.hits} misses=${cacheStats.misses} writes=${cacheStats.writes} errors=${cacheStats.errors}`);
      }
      if (providerStats) {
        display.log(`[PROVIDER GUARD] attempts=${providerStats.attempts} retries=${providerStats.retries} failures=${providerStats.failures} rateLimits=${providerStats.rateLimits} timeouts=${providerStats.timeouts} nonRetryable=${providerStats.nonRetryableFailures}`);
      }
      display.finalize();
      console.log(colors.dim(`  Insight: ${insightSuccessCount} OK, ${insightErrorCount} errors`));
    }

    console.log(colors.dim(`  Log: ${display.getLogPath()}`));
  } catch (err) {
    console.error(colors.red(`Scan failed: ${err}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function phaseSummary(phase: string, p: ScanProgress, display: ScanDisplay, cfg: IndexRuntimeConfigSummary): string {
  let detail: string;
  switch (phase) {
    case 'structure': {
      const changed = display.getChangedCount();
      const skipped = display.getSkippedCount();
      const parts = [`${p.totalFiles} files`];
      if (changed > 0) parts.push(`${changed} changed`);
      if (skipped > 0) parts.push(`${skipped} unchanged`);
      parts.push(`${p.totalMethods} methods`);
      detail = parts.join(', ');
      break;
    }
    case 'insight':
      detail = `${p.totalFiles} files`;
      break;
    case 'vectors':
      detail = `${p.totalFiles} files`;
      break;
    default:
      detail = `${p.totalFiles} files`;
  }

  let label: string;
  if (phase === 'structure') {
    label = 'Structure';
  } else if (phase === 'insight') {
    label = `AI Insight [${cfg.llmProvider} ${cfg.llmModel}]`;
  } else if (phase === 'vectors') {
    label = `Vectors [${cfg.embeddingProvider} ${cfg.embeddingModel}]`;
  } else {
    label = phase;
  }

  return colors.green(`✓ ${label}`) + ` ${colors.dim(`(${detail})`)}`;
}
