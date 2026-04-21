import * as fs from 'fs';
import * as path from 'path';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { HeaderJson } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';
import { normalizeProjectPath } from '../../utils/projectPath';

export class HeaderStore implements IHeaderStore {
  private projectRoot: string;
  private headersDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.headersDir = path.join(this.projectRoot, '.nanocontext', 'headers');
    if (!fs.existsSync(this.headersDir)) {
      fs.mkdirSync(this.headersDir, { recursive: true });
    }
  }

  getHeaderPath(sourceFilePath: string): string {
    const relativePath = normalizeProjectPath(sourceFilePath, this.projectRoot);
    return path.join(this.headersDir, relativePath + '.header.json');
  }

  async read(filePath: string): Promise<HeaderJson | null> {
    const headerPath = this.getHeaderPath(filePath);
    if (!fs.existsSync(headerPath)) return null;
    const raw = fs.readFileSync(headerPath, 'utf-8');
    return applyHeaderIdentity(JSON.parse(raw));
  }

  async write(filePath: string, header: HeaderJson): Promise<void> {
    const headerPath = this.getHeaderPath(filePath);
    const dir = path.dirname(headerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(headerPath, JSON.stringify(applyHeaderIdentity(header), null, 2), 'utf-8');
  }

  async remove(filePath: string): Promise<void> {
    const headerPath = this.getHeaderPath(filePath);
    if (fs.existsSync(headerPath)) {
      fs.unlinkSync(headerPath);
    }
  }

  exists(filePath: string): boolean {
    return fs.existsSync(this.getHeaderPath(filePath));
  }
}
