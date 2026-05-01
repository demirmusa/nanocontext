import * as fs from 'fs';
import * as path from 'path';
import { ScanManifest } from '../interfaces/types';

export const PARSER_VERSION = 'tree-sitter-wasms-v1';
export const INSIGHT_PROMPT_VERSION = 'insight-prompt-v1';

export class ScanManifestService {
  private manifestPath: string;

  constructor(projectRoot: string) {
    const dbDir = path.join(projectRoot, '.nanocontext', 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.manifestPath = path.join(dbDir, 'scan-manifest.json');
  }

  create(params: Omit<ScanManifest, 'generationId' | 'startedAt' | 'status' | 'indexedFiles' | 'changedFiles' | 'skippedFiles' | 'failedFiles' | 'totalMethods' | 'files'>): ScanManifest {
    const startedAt = new Date().toISOString();
    return {
      generationId: `scan_${startedAt.replace(/[-:.TZ]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt,
      status: 'running',
      indexedFiles: 0,
      changedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      totalMethods: 0,
      files: [],
      ...params,
    };
  }

  save(manifest: ScanManifest): void {
    const previous = this.readLatest();
    const next = previous && previous.generationId !== manifest.generationId
      ? { ...previous, compactionCandidate: true }
      : previous;
    const payload = {
      latest: manifest,
      previous: next ? [next, ...this.readPrevious().filter(item => item.generationId !== next.generationId)].slice(0, 20) : this.readPrevious(),
    };
    fs.writeFileSync(this.manifestPath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  readLatest(): ScanManifest | null {
    try {
      if (!fs.existsSync(this.manifestPath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8')) as { latest?: ScanManifest };
      return parsed.latest ?? null;
    } catch {
      return null;
    }
  }

  readPrevious(): ScanManifest[] {
    try {
      if (!fs.existsSync(this.manifestPath)) {
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8')) as { previous?: ScanManifest[] };
      return parsed.previous ?? [];
    } catch {
      return [];
    }
  }
}
