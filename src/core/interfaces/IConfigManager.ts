import { ProjectConfig, UserConfig } from './types';

export interface IConfigManager {
  loadProjectConfig(): Promise<ProjectConfig>;
  loadUserConfig(): Promise<UserConfig>;
  saveProjectConfig(config: ProjectConfig): Promise<void>;
  saveUserConfig(config: UserConfig): Promise<void>;
  getProjectRoot(): string;
  isInitialized(): boolean;
  getDefaultProjectConfig(): ProjectConfig;
  getDefaultUserConfig(): UserConfig;
}
