import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, UserConfig } from '../interfaces/types';
import { IConfigManager } from '../interfaces/IConfigManager';

export class ConfigManager implements IConfigManager {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || this.findProjectRoot(process.cwd());
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  isInitialized(): boolean {
    return fs.existsSync(path.join(this.projectRoot, 'nanocontextconfig.json'));
  }

  async loadProjectConfig(): Promise<ProjectConfig> {
    const configPath = path.join(this.projectRoot, 'nanocontextconfig.json');
    if (!fs.existsSync(configPath)) {
      return this.getDefaultProjectConfig();
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...this.getDefaultProjectConfig(), ...JSON.parse(raw) };
  }

  async loadUserConfig(): Promise<UserConfig> {
    const configPath = path.join(this.projectRoot, '.nanocontext', 'config.json');
    if (!fs.existsSync(configPath)) {
      return this.getDisabledUserConfig();
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserConfig>;
    const defaults = this.getDefaultUserConfig();
    const disabled = this.getDisabledUserConfig();

    return {
      llm: parsed.llm?.provider === 'none'
        ? { ...disabled.llm, ...parsed.llm }
        : { ...defaults.llm, ...parsed.llm },
      embedding: parsed.embedding?.provider === 'none'
        ? { ...disabled.embedding, ...parsed.embedding }
        : { ...defaults.embedding, ...parsed.embedding },
    };
  }

  async saveProjectConfig(config: ProjectConfig): Promise<void> {
    const configPath = path.join(this.projectRoot, 'nanocontextconfig.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async saveUserConfig(config: UserConfig): Promise<void> {
    const dir = path.join(this.projectRoot, '.nanocontext');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  getDefaultProjectConfig(): ProjectConfig {
    return {
      version: 1,
      languages: [],
      include: ['src/**/*'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/*.min.js', '**/*.bundle.js'],
      aiInsight: true,
      aiInsightConcurrency: 20,
      watch: { debounceMs: 1000 },
      search: {
        defaultLimit: 3,
        maxLimit: 20,
        smartSearchEnabled: false,
        smartSearchCandidateMultiplier: 3,
      },
      dependencyDepth: 1,
    };
  }

  getDefaultUserConfig(): UserConfig {
    return {
      llm: {
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'llama3.2',
      },
      embedding: {
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'nomic-embed-text',
      },
    };
  }

  private getDisabledUserConfig(): UserConfig {
    return {
      llm: {
        provider: 'none',
        model: 'disabled',
      },
      embedding: {
        provider: 'none',
        model: 'disabled',
      },
    };
  }

  private findProjectRoot(startDir: string): string {
    let dir = startDir;
    while (true) {
      if (fs.existsSync(path.join(dir, 'nanocontextconfig.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        // Reached root, use startDir
        return startDir;
      }
      dir = parent;
    }
  }
}
