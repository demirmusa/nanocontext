import { confirm } from '@inquirer/prompts';
import * as fs from 'fs';
import * as path from 'path';
import { Container } from '../../core/Container';
import { colors } from '../utils/colors';

interface RemoveOptions {
  yes?: boolean;
}

export async function removeCommand(options: RemoveOptions = {}): Promise<void> {
  const container = new Container();
  const projectRoot = container.configManager.getProjectRoot();

  if (!container.configManager.isInitialized() && !fs.existsSync(path.join(projectRoot, '.nanocontext'))) {
    console.log(colors.red('NanoContext is not initialized in this project.'));
    process.exit(1);
  }

  const confirmed = options.yes || await confirm({
    message: `Remove NanoContext setup from ${projectRoot}?`,
    default: false,
  });

  if (!confirmed) {
    console.log(colors.dim('Cancelled.'));
    return;
  }

  try {
    const agentResult = container.agentSetupService.removeSetup(projectRoot);
    const removedFiles: string[] = [];

    for (const relativePath of ['nanocontextconfig.json', '.nanocontextignore']) {
      if (removePath(path.join(projectRoot, relativePath))) {
        removedFiles.push(relativePath);
      }
    }

    if (removePath(path.join(projectRoot, '.nanocontext'))) {
      removedFiles.push('.nanocontext/');
    }

    if (removeGitignoreEntry(projectRoot)) {
      removedFiles.push('.gitignore entry');
    }

    for (const file of agentResult.removedMcpConfigs) {
      console.log(colors.green(`  ✓ Removed ${file}`));
    }
    for (const file of agentResult.updatedAgentDocs) {
      console.log(colors.green(`  ✓ Updated ${file}`));
    }
    for (const file of agentResult.removedAgentDocs) {
      console.log(colors.green(`  ✓ Removed ${file}`));
    }
    for (const file of removedFiles) {
      console.log(colors.green(`  ✓ Removed ${file}`));
    }

    if (
      agentResult.removedMcpConfigs.length === 0
      && agentResult.updatedAgentDocs.length === 0
      && agentResult.removedAgentDocs.length === 0
      && removedFiles.length === 0
    ) {
      console.log(colors.dim('No NanoContext files found.'));
      return;
    }

    console.log(colors.green('\n✓ NanoContext removed.'));
  } catch (err) {
    console.error(colors.red(`Remove failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    await container.dispose();
  }
}

function removePath(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function removeGitignoreEntry(projectRoot: string): boolean {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter(line => line.trim() !== '.nanocontext/');
  if (filtered.length === lines.length) return false;

  const updated = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!updated) {
    fs.unlinkSync(gitignorePath);
  } else {
    fs.writeFileSync(gitignorePath, `${updated}\n`, 'utf-8');
  }

  return true;
}
