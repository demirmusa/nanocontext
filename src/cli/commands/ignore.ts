import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../../core/config/ConfigManager';
import { normalizeProjectPath } from '../../utils/projectPath';
import { colors } from '../utils/colors';

export async function ignoreCommand(target: string): Promise<void> {
  const configManager = new ConfigManager();
  if (!configManager.isInitialized()) {
    console.log(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    const projectRoot = configManager.getProjectRoot();
    const entry = buildIgnoreEntry(target, projectRoot, process.cwd());
    const ignorePath = path.join(projectRoot, '.nanocontextignore');
    const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf-8') : '';
    const lines = existing.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    if (lines.includes(entry)) {
      console.log(colors.dim(`Already ignored: ${entry}`));
      return;
    }

    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(ignorePath, `${prefix}${entry}\n`, 'utf-8');
    console.log(colors.green(`Ignored: ${entry}`));
    console.log(colors.dim('Run `nc scan` to remove previously indexed matching files.'));
  } catch (err) {
    console.error(colors.red(`Ignore failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

export function buildIgnoreEntry(target: string, projectRoot: string, cwd: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error('Provide a path or glob to ignore.');
  }

  if (hasGlobChars(trimmed)) {
    return normalizePattern(trimmed);
  }

  const resolved = path.resolve(cwd, trimmed);
  const relative = normalizeProjectPath(resolved, projectRoot);
  if (relative === '.') {
    throw new Error('Refusing to ignore the project root. Run this from a subdirectory or pass a subpath.');
  }

  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (stat?.isDirectory() || trimmed.endsWith('/') || trimmed.endsWith('\\')) {
    return `${relative.replace(/\/+$/, '')}/**`;
  }

  return relative;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/\/+$/, '');
}

function hasGlobChars(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}
