import * as path from 'path';
import * as lancedb from 'vectordb';
import { IVectorStore } from '../interfaces/IVectorStore';
import { VectorRecord, SearchResult } from '../interfaces/types';

export class LanceVectorStore implements IVectorStore {
  private dbPath: string;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private tableReady: Promise<void> | null = null;
  constructor(projectRoot: string) {
    this.dbPath = path.join(projectRoot, '.nanocontext', 'db', 'vectors.lance');
  }

  async initialize(_dimensions: number): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);

    const tableNames = await this.db.tableNames();
    if (tableNames.includes('vectors')) {
      this.table = await this.db.openTable('vectors');
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!this.db) throw new Error('VectorStore not initialized');
    if (records.length === 0) return;

    const data = records.map(r => ({
      id: r.id,
      vector: r.vector,
      type: r.type,
      file: r.file,
      method: r.method || '',
      class_name: r.class || '',
      loc: r.loc || '',
      sig: r.sig || '',
      refs: JSON.stringify(r.refs || []),
      insight: r.insight || '',
      lang: r.lang || '',
      text: r.text || '',
      generation_id: r.generationId || '',
    }));

    if (!this.table && !this.tableReady) {
      // First concurrent caller creates the table with its data
      this.tableReady = this.db.createTable('vectors', data).then(t => { this.table = t; });
      await this.tableReady;
      return;
    }

    if (!this.table && this.tableReady) {
      // Concurrent callers wait for the table, then add normally
      await this.tableReady;
    }

    // Remove existing records with same IDs (escape single quotes to prevent injection)
    const ids = records.map(r => r.id.replace(/'/g, "''"));
    try {
      await this.table!.delete(`id IN ('${ids.join("','")}')`);
    } catch (_) {
      // Table might be empty or IDs don't exist
    }
    await this.table!.add(data);
  }

  async remove(ids: string[]): Promise<void> {
    if (!this.table || ids.length === 0) return;
    try {
      const escaped = ids.map(id => id.replace(/'/g, "''"));
      await this.table.delete(`id IN ('${escaped.join("','")}')`);
    } catch (_) {
      // Ignore if not found
    }
  }

  async removeByFile(filePath: string): Promise<void> {
    if (!this.table) return;
    try {
      const escaped = filePath.replace(/'/g, "''");
      await this.table.delete(`file = '${escaped}'`);
    } catch (_) {
      // Ignore if not found
    }
  }

  async search(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<SearchResult[]> {
    if (!this.table) return [];

    const overscanLimit = filter?.type && filter.type !== 'all'
      ? Math.max(limit * 5, limit)
      : limit;
    const results = await this.table.search(vector).limit(overscanLimit).execute();

    let mapped = results.map((r: Record<string, unknown>) => ({
      id: r.id as string || undefined,
      type: r.type as 'method' | 'class' | 'memory',
      file: r.file as string || undefined,
      method: r.method as string || undefined,
      class: r.class_name as string || undefined,
      loc: r.loc as string || undefined,
      sig: r.sig as string || undefined,
      refs: r.refs ? JSON.parse(r.refs as string) : undefined,
      insight: r.insight as string || undefined,
      text: r.text as string || undefined,
      generationId: r.generation_id as string || undefined,
      score: r._distance as number || undefined,
    }));

    // Apply post-query filtering if filter is specified
    if (filter) {
      if (filter.type && filter.type !== 'all') {
        mapped = mapped.filter(r => r.type === filter.type);
      }
    }

    return mapped.slice(0, limit);
  }

  async clear(): Promise<void> {
    if (this.db && this.table) {
      await this.db.dropTable('vectors');
      this.table = null;
      this.tableReady = null;
    }
  }

  async count(): Promise<number> {
    if (!this.table) return 0;
    return await this.table.countRows();
  }
}
