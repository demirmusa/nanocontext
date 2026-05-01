import * as fs from 'fs';
import * as path from 'path';

export function loadGitignorePatterns(projectRoot: string): string[] {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  return fs.readFileSync(gitignorePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
}
