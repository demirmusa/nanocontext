import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { EmbeddingConfig, LLMConfig } from '../interfaces/types';

export interface InitConfigInput {
  languages: string[];
  includePatterns: string[];
  aiInsight: boolean;
  smartSearchEnabled: boolean;
  llm: LLMConfig;
  embedding: EmbeddingConfig;
}

export interface ProjectDetectionSummary {
  languages: string[];
  sourceDirs: string[];
  defaultIncludePatterns: string[];
}

export class ProjectInitService {
  isInitialized(cwd: string): boolean {
    return new ConfigManager(cwd).isInitialized();
  }

  detectProject(cwd: string): ProjectDetectionSummary {
    const languages = this.detectLanguages(cwd);
    const sourceDirs = this.detectSourceDirs(cwd, languages);
    return {
      languages,
      sourceDirs,
      defaultIncludePatterns: sourceDirs.map(sourceDir => sourceDir === '.' ? '**/*' : `${sourceDir}/**/*`),
    };
  }

  detectLanguages(dir: string): string[] {
    const langs = new Set<string>();
    const extMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.cs': 'csharp',
    };

    const walk = (currentDir: string, depth: number): void => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else {
            const language = extMap[path.extname(entry.name)];
            if (language) langs.add(language);
          }
        }
      } catch { /* ignore */ }
    };

    walk(dir, 0);
    return Array.from(langs);
  }

  detectSourceDirs(dir: string, langs: string[]): string[] {
    const extSet = new Set<string>();
    for (const lang of langs) {
      if (lang === 'typescript') { extSet.add('.ts'); extSet.add('.tsx'); }
      if (lang === 'javascript') { extSet.add('.js'); extSet.add('.jsx'); }
      if (lang === 'csharp') extSet.add('.cs');
    }

    const candidates = new Map<string, number>();
    const skip = new Set(['.git', 'node_modules', 'dist', 'bin', 'obj', '.nanocontext', '__tests__', 'test', 'tests']);

    const walk = (currentDir: string, depth: number): void => {
      if (depth > 2) return;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (extSet.has(path.extname(entry.name))) {
            const rel = path.relative(dir, currentDir).replace(/\\/g, '/') || '.';
            const topDir = rel === '.' ? '.' : rel.split('/')[0];
            candidates.set(topDir, (candidates.get(topDir) || 0) + 1);
          }
        }
      } catch { /* ignore */ }
    };

    walk(dir, 0);

    const sorted = [...candidates.entries()]
      .filter(([, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([sourceDir]) => sourceDir);

    return sorted.length > 0 ? sorted : ['src'];
  }

  async saveInitConfig(cwd: string, input: InitConfigInput): Promise<void> {
    const configManager = new ConfigManager(cwd);
    const projectConfig = configManager.getDefaultProjectConfig();
    projectConfig.languages = input.languages;
    projectConfig.include = input.includePatterns;
    projectConfig.aiInsight = input.aiInsight;
    projectConfig.search.smartSearchEnabled = input.smartSearchEnabled;
    await configManager.saveProjectConfig(projectConfig);
    await configManager.saveUserConfig({
      llm: input.llm,
      embedding: input.embedding,
    });
  }

  scaffoldProjectFiles(cwd: string): string[] {
    const changes: string[] = [];
    const ignorePath = path.join(cwd, '.nanocontextignore');
    if (!fs.existsSync(ignorePath)) {
      fs.writeFileSync(ignorePath, '**/node_modules/**\n**/dist/**\n**/.git/**\n**/bin/**\n**/obj/**\n*.min.js\n*.bundle.js\n', 'utf-8');
      changes.push('.nanocontextignore');
    }

    const gitignorePath = path.join(cwd, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.nanocontext/')) {
        fs.appendFileSync(gitignorePath, '\n.nanocontext/\n');
        changes.push('.gitignore');
      }
    } else {
      fs.writeFileSync(gitignorePath, '.nanocontext/\n', 'utf-8');
      changes.push('.gitignore');
    }

    for (const dir of ['.nanocontext/db', '.nanocontext/headers', '.nanocontext/logs']) {
      const dirPath = path.join(cwd, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        changes.push(`${dir}/`);
      }
    }

    return changes;
  }

  ensureProjectFiles(cwd: string): string[] {
    return this.scaffoldProjectFiles(cwd);
  }
}
