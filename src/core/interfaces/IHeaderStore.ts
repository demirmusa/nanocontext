import { HeaderJson } from './types';

export interface IHeaderStore {
  read(filePath: string): Promise<HeaderJson | null>;
  write(filePath: string, header: HeaderJson): Promise<void>;
  remove(filePath: string): Promise<void>;
  exists(filePath: string): boolean;
  getHeaderPath(sourceFilePath: string): string;
}
