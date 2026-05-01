import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { IStateStore } from '../interfaces/IStateStore';
import { InsightQueueItem, SearchResult } from '../interfaces/types';

export class SqliteStateStore implements IStateStore {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(projectRoot: string) {
    const dbDir = path.join(projectRoot, '.nanocontext', 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.dbPath = path.join(dbDir, 'state.sqlite');
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.function('regexp', (pattern: string, value: string) => {
      if (!value) return 0;
      try { return new RegExp(pattern, 'i').test(value) ? 1 : 0; } catch { return 0; }
    });

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_checksums (
        file_path TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS insight_queue (
        file TEXT NOT NULL,
        method_id TEXT NOT NULL,
        method_name TEXT NOT NULL,
        method_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retries INTEGER DEFAULT 0,
        queued_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (file, method_id)
      );

      CREATE TABLE IF NOT EXISTS scan_stats (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_index (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        file TEXT NOT NULL,
        name TEXT NOT NULL,
        class TEXT,
        sig TEXT,
        loc TEXT,
        insight TEXT,
        generation_id TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
        id UNINDEXED,
        type UNINDEXED,
        file,
        name,
        class,
        sig,
        insight
      );
    `);

    this.migrateInsightQueue();
    this.migrateSearchIndexGeneration();
    this.rebuildSearchFts();
  }

  private migrateInsightQueue(): void {
    const queueColumns = this.db!.prepare("PRAGMA table_info('insight_queue')").all() as Array<{ name: string }>;
    const hasMethodId = queueColumns.some(column => column.name === 'method_id');
    if (hasMethodId) return;

    this.db!.exec(`
      ALTER TABLE insight_queue RENAME TO insight_queue_legacy;
      CREATE TABLE insight_queue (
        file TEXT NOT NULL,
        method_id TEXT NOT NULL,
        method_name TEXT NOT NULL,
        method_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retries INTEGER DEFAULT 0,
        queued_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (file, method_id)
      );
      INSERT OR IGNORE INTO insight_queue (file, method_id, method_name, method_code, status, retries, queued_at)
      SELECT file, method_name, method_name, method_code, status, retries, queued_at
      FROM insight_queue_legacy;
      DROP TABLE insight_queue_legacy;
    `);
  }

  getChecksum(filePath: string): string | null {
    const row = this.db!.prepare('SELECT checksum FROM file_checksums WHERE file_path = ?').get(filePath) as { checksum: string } | undefined;
    return row?.checksum ?? null;
  }

  listTrackedFiles(): string[] {
    const rows = this.db!.prepare('SELECT file_path FROM file_checksums').all() as Array<{ file_path: string }>;
    return rows.map(row => row.file_path);
  }

  setChecksum(filePath: string, checksum: string): void {
    this.db!.prepare(
      'INSERT OR REPLACE INTO file_checksums (file_path, checksum, updated_at) VALUES (?, ?, datetime(\'now\'))'
    ).run(filePath, checksum);
  }

  removeFile(filePath: string): void {
    this.db!.prepare('DELETE FROM file_checksums WHERE file_path = ?').run(filePath);
    this.db!.prepare('DELETE FROM insight_queue WHERE file = ?').run(filePath);
    this.db!.prepare('DELETE FROM search_index WHERE file = ?').run(filePath);
    this.db!.prepare('DELETE FROM search_index_fts WHERE file = ?').run(filePath);
  }

  private migrateSearchIndexGeneration(): void {
    const columns = this.db!.prepare("PRAGMA table_info('search_index')").all() as Array<{ name: string }>;
    const hasGenerationId = columns.some(column => column.name === 'generation_id');
    if (!hasGenerationId) {
      this.db!.exec('ALTER TABLE search_index ADD COLUMN generation_id TEXT');
    }
  }

  enqueueInsight(item: InsightQueueItem): void {
    this.db!.prepare(
      'INSERT OR IGNORE INTO insight_queue (file, method_id, method_name, method_code, status, retries, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(item.file, item.methodId, item.methodName, item.methodCode, item.status, item.retries, item.queuedAt);
  }

  dequeueInsight(batchSize: number): InsightQueueItem[] {
    const rows = this.db!.prepare(
      'SELECT file, method_id, method_name, method_code, status, retries, queued_at FROM insight_queue WHERE status = ? LIMIT ?'
    ).all('pending', batchSize) as Array<{ file: string; method_id: string; method_name: string; method_code: string; status: string; retries: number; queued_at: string }>;

    // Mark as processing
    const updateStmt = this.db!.prepare('UPDATE insight_queue SET status = ? WHERE file = ? AND method_id = ?');
    for (const row of rows) {
      updateStmt.run('processing', row.file, row.method_id);
    }

    return rows.map(r => ({
      file: r.file,
      methodId: r.method_id,
      methodName: r.method_name,
      methodCode: r.method_code,
      status: 'processing' as const,
      retries: r.retries,
      queuedAt: r.queued_at,
    }));
  }

  completeInsight(file: string, methodId: string): void {
    this.db!.prepare('DELETE FROM insight_queue WHERE file = ? AND method_id = ?').run(file, methodId);
  }

  failInsight(file: string, methodId: string): void {
    this.db!.prepare(
      'UPDATE insight_queue SET status = ?, retries = retries + 1 WHERE file = ? AND method_id = ?'
    ).run('pending', file, methodId);
  }

  getPendingInsightCount(): number {
    const row = this.db!.prepare('SELECT COUNT(*) as count FROM insight_queue WHERE status IN (?, ?)').get('pending', 'processing') as { count: number };
    return row.count;
  }

  isInsightPending(file: string): boolean {
    const row = this.db!.prepare('SELECT COUNT(*) as count FROM insight_queue WHERE file = ? AND status = ?').get(file, 'pending') as { count: number };
    return row.count > 0;
  }

  indexMethod(id: string, file: string, name: string, className: string | undefined, sig: string, loc: string, insight: string | undefined, generationId?: string): void {
    this.db!.prepare(
      'INSERT OR REPLACE INTO search_index (id, type, file, name, class, sig, loc, insight, generation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'method', file, name, className ?? null, sig, loc, insight ?? null, generationId ?? null);
    this.indexFts(id, 'method', file, name, className, sig, insight);
  }

  indexClass(id: string, file: string, name: string, loc: string, insight: string | undefined, generationId?: string): void {
    this.db!.prepare(
      'INSERT OR REPLACE INTO search_index (id, type, file, name, class, sig, loc, insight, generation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'class', file, name, name, null, loc, insight ?? null, generationId ?? null);
    this.indexFts(id, 'class', file, name, name, undefined, insight);
  }

  getFileIndexGenerations(file: string): string[] {
    const rows = this.db!.prepare(
      'SELECT DISTINCT generation_id FROM search_index WHERE file = ? AND generation_id IS NOT NULL'
    ).all(file) as Array<{ generation_id: string }>;
    return rows.map(row => row.generation_id);
  }

  removeFileIndex(file: string): void {
    this.db!.prepare('DELETE FROM search_index WHERE file = ?').run(file);
    this.db!.prepare('DELETE FROM search_index_fts WHERE file = ?').run(file);
  }

  searchExact(query: string, limit: number = 20): SearchResult[] {
    const pattern = `%${query}%`;
    const rows = this.db!.prepare(
      `SELECT id, type, file, name, class, sig, loc, insight FROM search_index
       WHERE name LIKE ? OR sig LIKE ? OR class LIKE ? OR file LIKE ?
       LIMIT ?`
    ).all(pattern, pattern, pattern, pattern, limit) as Array<{
      id: string; type: string; file: string; name: string; class: string | null;
      sig: string | null; loc: string | null; insight: string | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      type: r.type as 'method' | 'class',
      file: r.file,
      method: r.type === 'method' ? r.name : undefined,
      class: r.class ?? undefined,
      sig: r.sig ?? undefined,
      loc: r.loc ?? undefined,
      insight: r.insight ?? undefined,
    }));
  }

  searchLexical(query: string, limit: number = 20): SearchResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    try {
      const rows = this.db!.prepare(
        `SELECT si.id, si.type, si.file, si.name, si.class, si.sig, si.loc, si.insight,
                bm25(search_index_fts, 1.5, 3.0, 2.0, 1.2, 1.0) AS rank
         FROM search_index_fts
         JOIN search_index si ON si.id = search_index_fts.id
         WHERE search_index_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ?`
      ).all(ftsQuery, limit) as Array<{
        id: string; type: string; file: string; name: string; class: string | null;
        sig: string | null; loc: string | null; insight: string | null; rank: number;
      }>;

      return rows.map(r => ({
        id: r.id,
        type: r.type as 'method' | 'class',
        file: r.file,
        method: r.type === 'method' ? r.name : undefined,
        class: r.class ?? undefined,
        sig: r.sig ?? undefined,
        loc: r.loc ?? undefined,
        insight: r.insight ?? undefined,
        score: normalizeFtsRank(r.rank),
      }));
    } catch {
      return this.searchExact(query, limit);
    }
  }

  searchRegex(pattern: string, limit: number = 20): SearchResult[] {
    const rows = this.db!.prepare(
      `SELECT id, type, file, name, class, sig, loc, insight FROM search_index
       WHERE name REGEXP ? OR sig REGEXP ? OR class REGEXP ? OR file REGEXP ?
       LIMIT ?`
    ).all(pattern, pattern, pattern, pattern, limit) as Array<{
      id: string; type: string; file: string; name: string; class: string | null;
      sig: string | null; loc: string | null; insight: string | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      type: r.type as 'method' | 'class',
      file: r.file,
      method: r.type === 'method' ? r.name : undefined,
      class: r.class ?? undefined,
      sig: r.sig ?? undefined,
      loc: r.loc ?? undefined,
      insight: r.insight ?? undefined,
    }));
  }

  getStats(): { totalFiles: number; totalMethods: number; lastScanAt: string | null } {
    const files = this.db!.prepare('SELECT COUNT(*) as count FROM file_checksums').get() as { count: number };
    const lastScan = this.db!.prepare("SELECT value FROM scan_stats WHERE key = 'last_scan_at'").get() as { value: string } | undefined;
    const methods = this.db!.prepare("SELECT COUNT(*) as count FROM search_index WHERE type = 'method'").get() as { count: number };
    return {
      totalFiles: files.count,
      totalMethods: methods.count,
      lastScanAt: lastScan?.value ?? null,
    };
  }

  setLastScanAt(date: string): void {
    this.db!.prepare("INSERT OR REPLACE INTO scan_stats (key, value) VALUES ('last_scan_at', ?)").run(date);
  }

  setTotalMethods(count: number): void {
    this.db!.prepare("INSERT OR REPLACE INTO scan_stats (key, value) VALUES ('total_methods', ?)").run(String(count));
  }

  clearAll(): void {
    this.db!.exec('DELETE FROM file_checksums');
    this.db!.exec('DELETE FROM insight_queue');
    this.db!.exec('DELETE FROM scan_stats');
    this.db!.exec('DELETE FROM search_index');
    this.db!.exec('DELETE FROM search_index_fts');
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private indexFts(
    id: string,
    type: 'method' | 'class',
    file: string,
    name: string,
    className: string | undefined,
    sig: string | undefined,
    insight: string | undefined,
  ): void {
    this.db!.prepare('DELETE FROM search_index_fts WHERE id = ?').run(id);
    this.db!.prepare(
      'INSERT INTO search_index_fts (id, type, file, name, class, sig, insight) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, type, file, name, className ?? null, sig ?? null, insight ?? null);
  }

  private rebuildSearchFts(): void {
    const ftsCount = this.db!.prepare('SELECT COUNT(*) as count FROM search_index_fts').get() as { count: number };
    const indexCount = this.db!.prepare('SELECT COUNT(*) as count FROM search_index').get() as { count: number };
    if (ftsCount.count === indexCount.count) {
      return;
    }

    this.db!.exec('DELETE FROM search_index_fts');
    this.db!.exec(`
      INSERT INTO search_index_fts (id, type, file, name, class, sig, insight)
      SELECT id, type, file, name, class, sig, insight FROM search_index
    `);
  }
}

function buildFtsQuery(query: string): string {
  const terms = query
    .split(/[^A-Za-z0-9_./#-]+/)
    .map(term => term.trim())
    .filter(term => term.length > 0)
    .slice(0, 8);

  return terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}

function normalizeFtsRank(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 0;
  }
  return 1 / (1 + Math.max(0, Math.abs(rank)));
}
