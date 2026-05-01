import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { ProviderGuardStats } from '../providers/ProviderGuard';

export const EMBEDDING_PROMPT_VERSION = 'vector-text-v1';
export const VECTOR_SCHEMA_VERSION = 'vector-schema-v1';

export interface EmbeddingCacheStats {
  hits: number;
  misses: number;
  writes: number;
  errors: number;
}

interface CacheFile {
  version: number;
  records: Record<string, number[]>;
}

export class CachedEmbeddingProvider implements IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private cachePath: string;
  private cache: CacheFile = { version: 1, records: {} };
  private stats: EmbeddingCacheStats = { hits: 0, misses: 0, writes: 0, errors: 0 };

  constructor(
    private inner: IEmbeddingProvider,
    projectRoot: string,
    private model: string,
  ) {
    this.name = inner.name;
    this.dimensions = inner.dimensions;
    const cacheDir = path.join(projectRoot, '.nanocontext', 'db');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    this.cachePath = path.join(cacheDir, 'embedding-cache.json');
    this.loadCache();
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async embed(text: string): Promise<number[]> {
    const key = this.buildKey(text);
    const cached = this.cache.records[key];
    if (cached && cached.length === this.dimensions) {
      this.stats.hits++;
      return cached;
    }

    this.stats.misses++;
    const vector = await this.inner.embed(text);
    if (vector.length === this.dimensions) {
      this.cache.records[key] = vector;
      this.stats.writes++;
      this.saveCache();
    }
    return vector;
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getCacheStats(): EmbeddingCacheStats {
    return { ...this.stats };
  }

  getProviderGuardStats(): ProviderGuardStats | null {
    const provider = this.inner as IEmbeddingProvider & { getProviderGuardStats?: () => ProviderGuardStats };
    return provider.getProviderGuardStats?.() ?? null;
  }

  private buildKey(text: string): string {
    const textHash = createHash('sha256').update(text).digest('hex');
    return [
      this.name,
      this.model,
      this.dimensions,
      EMBEDDING_PROMPT_VERSION,
      VECTOR_SCHEMA_VERSION,
      textHash,
    ].join(':');
  }

  private loadCache(): void {
    try {
      if (!fs.existsSync(this.cachePath)) {
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as CacheFile;
      if (parsed.version === 1 && parsed.records && typeof parsed.records === 'object') {
        this.cache = parsed;
      }
    } catch {
      this.stats.errors++;
      this.cache = { version: 1, records: {} };
    }
  }

  private saveCache(): void {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache), 'utf-8');
    } catch {
      this.stats.errors++;
    }
  }
}
