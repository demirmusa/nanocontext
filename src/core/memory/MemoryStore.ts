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
        symbol TEXT,
        symbol_id TEXT,
        scope TEXT DEFAULT 'project',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        text,
        ref,
        file,
        symbol
      );
    `);
    this.migrateSchema();
    this.migrateMemoryFts();
  }

  async add(
    text: string,
    ref?: string,
    file?: string,
    scope: 'project' | 'file' | 'symbol' = 'project',
    symbol?: string,
    symbolId?: string,
  ): Promise<MemoryRecord> {
    const id = 'mem_' + crypto.randomBytes(3).toString('hex');
    const createdAt = new Date().toISOString();

    this.db.prepare(
      'INSERT INTO memories (id, text, ref, file, symbol, symbol_id, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, text, ref || null, file || null, symbol || null, symbolId || null, scope, createdAt);
    this.db.prepare(
      'INSERT INTO memories_fts (id, text, ref, file, symbol) VALUES (?, ?, ?, ?, ?)'
    ).run(id, text, ref || null, file || null, symbol || null);

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

    return { id, text, createdAt, ref, file, symbol, symbolId, scope };
  }

  async list(search?: string, file?: string, symbolId?: string): Promise<MemoryRecord[]> {
    let rows;
    if (search && file && symbolId) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE (text LIKE ? OR file LIKE ? OR symbol LIKE ?) AND file = ? AND symbol_id = ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`, `%${search}%`, file, symbolId) as MemoryRow[];
    } else if (search && file) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE (text LIKE ? OR file LIKE ? OR symbol LIKE ?) AND file = ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`, `%${search}%`, file) as MemoryRow[];
    } else if (search && symbolId) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE (text LIKE ? OR file LIKE ? OR symbol LIKE ?) AND symbol_id = ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`, `%${search}%`, symbolId) as MemoryRow[];
    } else if (search) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE text LIKE ? OR file LIKE ? OR symbol LIKE ? ORDER BY created_at DESC'
      ).all(`%${search}%`, `%${search}%`, `%${search}%`) as MemoryRow[];
    } else if (file && symbolId) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE file = ? AND symbol_id = ? ORDER BY created_at DESC'
      ).all(file, symbolId) as MemoryRow[];
    } else if (file) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE file = ? ORDER BY created_at DESC'
      ).all(file) as MemoryRow[];
    } else if (symbolId) {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE symbol_id = ? ORDER BY created_at DESC'
      ).all(symbolId) as MemoryRow[];
    } else {
      rows = this.db.prepare(
        'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories ORDER BY created_at DESC'
      ).all() as MemoryRow[];
    }

    return rows.map(mapMemoryRow);
  }

  async listByFile(file: string): Promise<MemoryRecord[]> {
    return this.list(undefined, file);
  }

  async listBySymbol(symbolId: string): Promise<MemoryRecord[]> {
    return this.list(undefined, undefined, symbolId);
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
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
    if (rows.length > 0) {
      const placeholders = rows.map(() => '?').join(', ');
      this.db.prepare(`DELETE FROM memories_fts WHERE id IN (${placeholders})`).run(...rows.map(r => r.id));
    }

    if (this.vectorStore && rows.length > 0) {
      await this.vectorStore.remove(rows.map(r => `memory::${r.id}`));
    }

    return result.changes;
  }

  searchLexical(query: string, limit: number = 10): MemoryRecord[] {
    const ftsQuery = buildMemoryFtsQuery(query);
    if (!ftsQuery) return [];
    try {
      const rows = this.db.prepare(
        `SELECT m.id, m.text, m.ref, m.file, m.symbol, m.symbol_id, m.scope, m.created_at
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.id
         WHERE memories_fts MATCH ?
         ORDER BY bm25(memories_fts) ASC
         LIMIT ?`
      ).all(ftsQuery, limit) as MemoryRow[];
      return rows.map(mapMemoryRow);
    } catch {
      return [];
    }
  }

  async findSimilar(text: string, threshold?: number, limit: number = 5): Promise<MemoryRecord[]> {
    // If no embedding, fall back to lexical search
    if (!this.embeddingProvider || !this.vectorStore) {
      const fallback = this.searchLexical(text, limit);
      return fallback.length > 0 ? fallback : (await this.list(text.split(' ')[0])).slice(0, limit);
    }

    try {
      const vector = await this.embeddingProvider.embed(text);
      const results = await this.vectorStore.search(vector, limit, { type: 'memory' });

      const memories: MemoryRecord[] = [];
      for (const r of results) {
        if (r.text && (!threshold || (r.score !== undefined && r.score <= threshold))) {
          const rows = this.db.prepare(
            'SELECT id, text, ref, file, symbol, symbol_id, scope, created_at FROM memories WHERE text = ?'
          ).all(r.text) as MemoryRow[];

          for (const row of rows) {
            memories.push(mapMemoryRow(row));
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

  private migrateMemoryFts(): void {
    const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM memories_fts').get() as { count: number };
    const memCount = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    if (ftsCount.count === memCount.count) return;

    this.db.exec('DELETE FROM memories_fts');
    this.db.exec(`
      INSERT INTO memories_fts (id, text, ref, file, symbol)
      SELECT id, text, ref, file, symbol FROM memories
    `);
  }

  private migrateSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info('memories')").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'file')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN file TEXT");
    }
    if (!columns.some(column => column.name === 'scope')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN scope TEXT DEFAULT 'project'");
    }
    if (!columns.some(column => column.name === 'symbol')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN symbol TEXT');
    }
    if (!columns.some(column => column.name === 'symbol_id')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN symbol_id TEXT');
    }
  }
}

interface MemoryRow {
  id: string;
  text: string;
  ref: string | null;
  file: string | null;
  symbol: string | null;
  symbol_id: string | null;
  scope: string | null;
  created_at: string;
}

function buildMemoryFtsQuery(query: string): string {
  const terms = query
    .split(/[^A-Za-z0-9_./#-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, 8);
  return terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function mapMemoryRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    ref: row.ref || undefined,
    file: row.file || undefined,
    symbol: row.symbol || undefined,
    symbolId: row.symbol_id || undefined,
    scope: (row.scope as 'project' | 'file' | 'symbol' | null) ?? undefined,
  };
}
