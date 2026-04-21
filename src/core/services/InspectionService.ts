import { IConfigManager } from '../interfaces/IConfigManager';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { HeaderJson } from '../interfaces/types';
import { normalizeProjectPath, normalizeProjectPathFromUriSegment } from '../../utils/projectPath';

export interface InspectionResult {
  file: string;
  header: HeaderJson | null;
}

export class InspectionService {
  constructor(
    private configManager: IConfigManager,
    private headerStore: IHeaderStore,
  ) {}

  async inspect(filePath: string): Promise<InspectionResult> {
    const normalizedPath = normalizeProjectPath(filePath, this.configManager.getProjectRoot());
    return {
      file: normalizedPath,
      header: await this.headerStore.read(normalizedPath),
    };
  }

  async inspectUriSegment(segment: string): Promise<InspectionResult> {
    const normalizedPath = normalizeProjectPathFromUriSegment(segment, this.configManager.getProjectRoot());
    return {
      file: normalizedPath,
      header: await this.headerStore.read(normalizedPath),
    };
  }
}
