import * as fs from 'fs';
import { IConfigManager } from '../interfaces/IConfigManager';
import { resolveProjectPath } from '../../utils/projectPath';

export interface CodeSnippetResult {
  content: string;
  warning?: string;
  error?: string;
}

export class CodeReadService {
  constructor(private configManager: IConfigManager) {}

  readSnippet(filePath: string, loc: string): CodeSnippetResult {
    const projectRoot = this.configManager.getProjectRoot();
    const { absolutePath } = resolveProjectPath(filePath, projectRoot);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const allLines = content.split('\n');
    const total = allLines.length;
    const [start, end] = loc.split('-').map(Number);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
      return { content: '', error: `invalid line range: ${loc}` };
    }

    if (start > total) {
      return { content: '', error: `lines ${start}-${end} out of range. File has ${total} lines (1-${total}).` };
    }

    const clampedEnd = Math.min(end, total);
    return {
      content: allLines.slice(start - 1, clampedEnd).join('\n'),
      warning: end > total ? `[truncated: file has ${total} lines]` : undefined,
    };
  }
}
