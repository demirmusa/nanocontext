import { Container } from '../../core/Container';
import { ScanManifestService } from '../../core/services/ScanManifestService';
import { colors } from '../utils/colors';

export async function scanManifestCommand(options: { json?: boolean } = {}): Promise<void> {
  const container = new Container();

  if (!container.configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  const manifest = new ScanManifestService(container.configManager.getProjectRoot()).readLatest();
  if (!manifest) {
    console.log(colors.yellow('No scan manifest found. Run `nc scan`.'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  console.log(colors.bold('\nScan Manifest\n'));
  console.log(`  Generation:   ${colors.cyan(manifest.generationId)}`);
  console.log(`  Status:       ${manifest.status}`);
  console.log(`  Started:      ${manifest.startedAt}`);
  console.log(`  Finished:     ${manifest.finishedAt ?? 'running'}`);
  console.log(`  Files:        ${manifest.indexedFiles} indexed, ${manifest.changedFiles} changed, ${manifest.skippedFiles} skipped, ${manifest.failedFiles} failed`);
  console.log(`  Methods:      ${manifest.totalMethods}`);
  console.log(`  Parser:       ${manifest.parserVersion}`);
  console.log(`  Vectors:      ${manifest.vectorSchemaVersion} [${manifest.embeddingProvider} ${manifest.embeddingModel} dim=${manifest.embeddingDimensions}]`);
  console.log(`  Insight:      ${manifest.insightPromptVersion}`);

  const failed = manifest.files.filter(file => file.status === 'failed').slice(0, 20);
  if (failed.length > 0) {
    console.log('');
    console.log(colors.yellow('Failed files:'));
    for (const file of failed) {
      console.log(`  ${file.file}: ${file.error ?? 'unknown error'}`);
    }
  }
}
