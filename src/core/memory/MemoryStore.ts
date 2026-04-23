import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { IVectorStore } from '../interfaces/IVectorStore';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { MemoryRecord } from '../interfaces/types';

export class MemoryStore implements IMemoryStore {
  private db: Database.Database;

  constructor(
    projectRoot: string,
    private vectorStore: IVectorStore | null = null,
    private embeddingProvider: IEmbeddingProvider | null = null,
  ) {
    const dbDir = path.join(projectRoot, '.nanocontext', 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(path.join(dbDir, 'state.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        ref TEXT,
        file TEXT,
        scope TEXT DEFAULT 'project',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    this.migrateSchema();
  }

  async add(text: string, ref?: string, file?: string, scope: 'project' | 'file' = 'project'): Promise<MemoryRecord> {
    const id = 'mem_' + crypto.randomBytes(3).toString('hex');
    const createdAt = new Date().toISOString();

    this.db.prepare(
      'INSERT INTO memories (id, text, ref, file, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, text, ref || null, file || null, scope, createdAt);

    // Add to vector store if available
    if (this.vectorStore && this.embeddingProvider) {
      try {
        const vector = await this.embeddingProvider.embed(text);
        await this.vectorStore.upsert([{
          id: `memory::${id}`,
          vector,
          type: 'memory',
          file: file || ref || '',
          text,
        }]);
      } catch {
        // Non-critical
      }
    }

    return { id, text, createdAt, ref, file, scope };
  }

  async list(search?: string, file?: string): Promise<MemoryRecord[]> {
    let rows;
    if (search && file) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, scope, created_at FROM memories WHERE (text LIKE ? OR file LIKE ?) AND file = ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`, file) as Array<{ id: string; text: string; ref: string | null; file: string | null; scope: string | null; created_at: string }>;
    } else if (search) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, scope, created_at FROM memories WHERE text LIKE ? OR file LIKE ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`) as Array<{ id: string; text: string; ref: string | null; file: string | null; scope: string | null; created_at: string }>;
    } else if (file) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, scope, created_at FROM memories WHERE file = ? ORDER BY created_at DESC'
      ).all(file) as Array<{ id: string; text: string; ref: string | null; file: string | null; scope: string | null; created_at: string }>;
    } else {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, scope, created_at FROM memories ORDER BY created_at DESC'
      ).all() as Array<{ id: string; text: string; ref: string | null; file: string | null; scope: string | null; created_at: string }>;
    }

    return rows.map(r => ({
      id: r.id,
      text: r.text,
      createdAt: r.created_at,
      ref: r.ref || undefined,
      file: r.file || undefined,
      scope: (r.scope as 'project' | 'file' | null) ?? undefined,
    }));
  }

  async listByFile(file: string): Promise<MemoryRecord[]> {
    return this.list(undefined, file);
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    if (this.vectorStore) {
      await this.vectorStore.remove([`memory::${id}`]);
    }
    return result.changes > 0;
  }

  async removeBefore(date: string): Promise<number> {
    const rows = this.db.prepare(
      'SELECT id FROM memories WHERE created_at < ?'
    ).all(date) as Array<{ id: string }>;

    const result = this.db.prepare('DELETE FROM memories WHERE created_at < ?').run(date);

    if (this.vectorStore && rows.length > 0) {
      await this.vectorStore.remove(rows.map(r => `memory::${r.id}`));
    }

    return result.changes;
  }

  async findSimilar(text: string, threshold?: number, limit: number = 5): Promise<MemoryRecord[]> {
    // If no embedding, fall back to text search
    if (!this.embeddingProvider || !this.vectorStore) {
      const fallback = await this.list(text.split(' ')[0]);
      return fallback.slice(0, limit);
    }

    try {
      const vector = await this.embeddingProvider.embed(text);
      const results = await this.vectorStore.search(vector, limit, { type: 'memory' });

      const memories: MemoryRecord[] = [];
      for (const r of results) {
        if (r.text && (!threshold || (r.score !== undefined && r.score <= threshold))) {
          const rows = this.db.prepare(
            'SELECT id, text, ref, file, scope, created_at FROM memories WHERE text = ?'
          ).all(r.text) as Array<{ id: string; text: string; ref: string | null; file: string | null; scope: string | null; created_at: string }>;

          for (const row of rows) {
            memories.push({
              id: row.id,
              text: row.text,
              createdAt: row.created_at,
              ref: row.ref || undefined,
              file: row.file || undefined,
              scope: (row.scope as 'project' | 'file' | null) ?? undefined,
            });
          }
        }
      }
      return memories.slice(0, limit);
    } catch {
      return [];
    }
  }

  close(): void {
    this.db.close();
  }

  private migrateSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info('memories')").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'file')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN file TEXT");
    }
    if (!columns.some(column => column.name === 'scope')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN scope TEXT DEFAULT 'project'");
    }
  }
}
