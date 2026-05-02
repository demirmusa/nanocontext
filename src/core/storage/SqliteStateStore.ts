import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { IStateStore } from '../interfaces/IStateStore';
import { InsightQueueItem, SearchResult, StateReference, SymbolIndexMetadata } from '../interfaces/types';
import { isSearchStopWord } from '../search/search-stop-words';

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
        generation_id TEXT,
        namespace TEXT,
        decorators TEXT,
        visibility TEXT,
        is_async INTEGER,
        is_static INTEGER,
        parameters TEXT,
        return_type TEXT,
        extends_name TEXT,
        implements TEXT,
        imports TEXT,
        exports TEXT,
        refs TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
        id UNINDEXED,
        type UNINDEXED,
        file,
        name,
        class,
        sig,
        insight,
        refs,
        content
      );

      CREATE TABLE IF NOT EXISTS state_references (
        id TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        path TEXT NOT NULL,
        range TEXT NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT,
        symbol_id TEXT,
        context TEXT,
        generation_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_state_references_path ON state_references(path);
      CREATE INDEX IF NOT EXISTS idx_state_references_kind ON state_references(kind);
      CREATE INDEX IF NOT EXISTS idx_state_references_file ON state_references(file);
    `);

    this.migrateInsightQueue();
    this.migrateSearchIndexColumns();
    this.migrateSearchFts();
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
    this.db!.prepare('DELETE FROM state_references WHERE file = ?').run(filePath);
  }

  private migrateSearchIndexColumns(): void {
    const columns = this.db!.prepare("PRAGMA table_info('search_index')").all() as Array<{ name: string }>;
    const existing = new Set(columns.map(column => column.name));
    const additions: Record<string, string> = {
      generation_id: 'TEXT',
      namespace: 'TEXT',
      decorators: 'TEXT',
      visibility: 'TEXT',
      is_async: 'INTEGER',
      is_static: 'INTEGER',
      parameters: 'TEXT',
      return_type: 'TEXT',
      extends_name: 'TEXT',
      implements: 'TEXT',
      imports: 'TEXT',
      exports: 'TEXT',
      refs: 'TEXT',
    };
    for (const [name, type] of Object.entries(additions)) {
      if (!existing.has(name)) {
        this.db!.exec(`ALTER TABLE search_index ADD COLUMN ${name} ${type}`);
      }
    }
  }

  private migrateSearchFts(): void {
    const row = this.db!.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'search_index_fts'"
    ).get() as { sql: string } | undefined;
    if (row?.sql?.includes('content')) return;

    this.db!.exec('DROP TABLE IF EXISTS search_index_fts');
    this.db!.exec(`
      CREATE VIRTUAL TABLE search_index_fts USING fts5(
        id UNINDEXED,
        type UNINDEXED,
        file,
        name,
        class,
        sig,
        insight,
        refs,
        content
      );
    `);
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

  indexMethod(id: string, file: string, name: string, className: string | undefined, sig: string, loc: string, insight: string | undefined, generationId?: string, metadata?: SymbolIndexMetadata): void {
    this.db!.prepare(
      `INSERT OR REPLACE INTO search_index (
        id, type, file, name, class, sig, loc, insight, generation_id, namespace, decorators,
        visibility, is_async, is_static, parameters, return_type, extends_name, implements, imports, exports, refs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, 'method', file, name, className ?? null, sig, loc, insight ?? null, generationId ?? null,
      metadata?.namespace ?? null,
      stringifyJson(metadata?.decorators),
      metadata?.visibility ?? null,
      metadata?.isAsync === undefined ? null : Number(metadata.isAsync),
      metadata?.isStatic === undefined ? null : Number(metadata.isStatic),
      stringifyJson(metadata?.parameters),
      metadata?.returnType ?? null,
      metadata?.extends ?? null,
      stringifyJson(metadata?.implements),
      stringifyJson(metadata?.imports),
      stringifyJson(metadata?.exports),
      stringifyJson(metadata?.refs),
    );
    this.indexFts(id, 'method', file, name, className, sig, insight, metadata?.refs, metadata);
  }

  indexClass(id: string, file: string, name: string, loc: string, insight: string | undefined, generationId?: string, metadata?: SymbolIndexMetadata): void {
    this.db!.prepare(
      `INSERT OR REPLACE INTO search_index (
        id, type, file, name, class, sig, loc, insight, generation_id, namespace, decorators,
        visibility, is_async, is_static, parameters, return_type, extends_name, implements, imports, exports, refs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, 'class', file, name, name, null, loc, insight ?? null, generationId ?? null,
      metadata?.namespace ?? null,
      stringifyJson(metadata?.decorators),
      metadata?.visibility ?? null,
      null,
      null,
      null,
      null,
      metadata?.extends ?? null,
      stringifyJson(metadata?.implements),
      stringifyJson(metadata?.imports),
      stringifyJson(metadata?.exports),
      null,
    );
    this.indexFts(id, 'class', file, name, name, undefined, insight, undefined, metadata);
  }

  getFileIndexGenerations(file: string): string[] {
    const rows = this.db!.prepare(
      'SELECT DISTINCT generation_id FROM search_index WHERE file = ? AND generation_id IS NOT NULL'
    ).all(file) as Array<{ generation_id: string }>;
    return rows.map(row => row.generation_id);
  }

  getIndexedSymbolCount(): number {
    const row = this.db!.prepare(
      "SELECT COUNT(*) as count FROM search_index WHERE type IN ('method', 'class')"
    ).get() as { count: number };
    return row.count;
  }

  removeFileIndex(file: string): void {
    this.db!.prepare('DELETE FROM search_index WHERE file = ?').run(file);
    this.db!.prepare('DELETE FROM search_index_fts WHERE file = ?').run(file);
    this.db!.prepare('DELETE FROM state_references WHERE file = ?').run(file);
  }

  indexStateReference(reference: StateReference): void {
    const id = [
      reference.file,
      reference.path,
      reference.range,
      reference.kind,
      reference.symbolId ?? reference.symbol ?? '',
    ].join(':');
    this.db!.prepare(
      `INSERT OR REPLACE INTO state_references
       (id, file, path, range, kind, symbol, symbol_id, context, generation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      reference.file,
      reference.path,
      reference.range,
      reference.kind,
      reference.symbol ?? null,
      reference.symbolId ?? null,
      reference.context ?? null,
      reference.generationId ?? null,
    );
  }

  listStateReferences(query?: string, kind?: 'read' | 'write', limit: number = 50): StateReference[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (query?.trim()) {
      clauses.push('(path = ? OR path LIKE ? OR symbol LIKE ? OR file LIKE ?)');
      args.push(query.trim(), `%${query.trim()}%`, `%${query.trim()}%`, `%${query.trim()}%`);
    }
    if (kind) {
      clauses.push('kind = ?');
      args.push(kind);
    }
    args.push(limit);

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db!.prepare(
      `SELECT file, path, range, kind, symbol, symbol_id, context, generation_id
       FROM state_references
       ${where}
       ORDER BY file ASC, range ASC, path ASC
       LIMIT ?`
    ).all(...args) as StateReferenceRow[];

    return rows.map(mapStateReferenceRow);
  }

  searchExact(query: string, limit: number = 20): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const lowerQuery = trimmed.toLowerCase();
    const pattern = `%${escapeLike(lowerQuery)}%`;
    const candidateLimit = Math.max(limit * 50, 200);
    const searchableFields = exactSearchFieldExpressions();
    const where = searchableFields.map(expr => `${expr} LIKE ? ESCAPE '\\'`).join(' OR ');
    const orderArgs = [
      lowerQuery,
      lowerQuery,
      lowerQuery,
      lowerQuery,
      lowerQuery,
      `${escapeLike(lowerQuery)}%`,
      `${escapeLike(lowerQuery)}%`,
      pattern,
      pattern,
      pattern,
      pattern,
    ];
    const args = [
      ...searchableFields.map(() => pattern),
      ...orderArgs,
      candidateLimit,
    ];
    const rows = this.db!.prepare(
      `SELECT ${searchIndexSelectColumns()} FROM search_index
       WHERE ${where}
       ORDER BY
        CASE
          WHEN LOWER(name) = ? THEN 0
          WHEN LOWER(COALESCE(class, '')) = ? THEN 1
          WHEN LOWER(COALESCE(class, '') || '.' || name) = ? THEN 2
          WHEN LOWER(COALESCE(class, '') || '#' || name) = ? THEN 2
          WHEN LOWER(COALESCE(namespace, '') || '.' || name) = ? THEN 3
          WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 4
          WHEN LOWER(COALESCE(class, '')) LIKE ? ESCAPE '\\' THEN 5
          WHEN LOWER(sig) LIKE ? ESCAPE '\\' THEN 6
          WHEN LOWER(file) LIKE ? ESCAPE '\\' THEN 7
          WHEN LOWER(COALESCE(insight, '')) LIKE ? ESCAPE '\\' THEN 8
          WHEN LOWER(COALESCE(refs, '')) LIKE ? ESCAPE '\\' THEN 9
          ELSE 20
        END,
        LENGTH(file) ASC,
        name ASC
       LIMIT ?`
    ).all(...args) as SearchIndexRow[];

    return rows
      .map(row => ({
        row,
        score: scoreExactRow(trimmed, row),
      }))
      .sort((a, b) => b.score - a.score || a.row.file.localeCompare(b.row.file) || a.row.name.localeCompare(b.row.name))
      .slice(0, limit)
      .map(({ row, score }) => ({
        ...mapSearchIndexRow(row),
        score,
      }));
  }

  searchLexical(query: string, limit: number = 20): SearchResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    try {
      const rows = this.db!.prepare(
        `SELECT ${searchIndexSelectColumns('si')},
                bm25(search_index_fts, 0.1, 0.1, 2.0, 5.0, 4.0, 2.5, 1.5, 1.0, 0.8) AS rank
         FROM search_index_fts
         JOIN search_index si ON si.id = search_index_fts.id
         WHERE search_index_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ?`
      ).all(ftsQuery, limit) as Array<SearchIndexRow & { rank: number }>;

      return rows.map(r => ({
        ...mapSearchIndexRow(r),
        score: normalizeFtsRank(r.rank),
      }));
    } catch {
      return this.searchExact(query, limit);
    }
  }

  searchRegex(pattern: string, limit: number = 20): SearchResult[] {
    const rows = this.db!.prepare(
      `SELECT ${searchIndexSelectColumns()} FROM search_index
       WHERE name REGEXP ?
          OR sig REGEXP ?
          OR class REGEXP ?
          OR file REGEXP ?
          OR insight REGEXP ?
          OR refs REGEXP ?
          OR namespace REGEXP ?
          OR decorators REGEXP ?
          OR parameters REGEXP ?
          OR return_type REGEXP ?
          OR extends_name REGEXP ?
          OR implements REGEXP ?
          OR imports REGEXP ?
          OR exports REGEXP ?
          OR (COALESCE(class, '') || '.' || name) REGEXP ?
          OR (COALESCE(class, '') || '#' || name) REGEXP ?
       LIMIT ?`
    ).all(
      pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern,
      pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern,
      limit,
    ) as SearchIndexRow[];

    return rows.map(mapSearchIndexRow);
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
    this.db!.exec('DELETE FROM state_references');
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
    refs: string[] | undefined,
    metadata: SymbolIndexMetadata | undefined,
  ): void {
    this.db!.prepare('DELETE FROM search_index_fts WHERE id = ?').run(id);
    this.insertFts(id, type, file, name, className, sig, insight, refs, metadata);
  }

  private insertFts(
    id: string,
    type: 'method' | 'class',
    file: string,
    name: string,
    className: string | undefined,
    sig: string | undefined,
    insight: string | undefined,
    refs: string[] | undefined,
    metadata: SymbolIndexMetadata | undefined,
  ): void {
    this.db!.prepare(
      'INSERT INTO search_index_fts (id, type, file, name, class, sig, insight, refs, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      type,
      file,
      name,
      className ?? null,
      sig ?? null,
      insight ?? null,
      refs?.join(' ') ?? null,
      buildSearchContent({
        file,
        name,
        className,
        sig,
        insight,
        refs,
        metadata,
      }),
    );
  }

  private rebuildSearchFts(): void {
    const ftsCount = this.db!.prepare('SELECT COUNT(*) as count FROM search_index_fts').get() as { count: number };
    const indexCount = this.db!.prepare('SELECT COUNT(*) as count FROM search_index').get() as { count: number };
    if (ftsCount.count === indexCount.count) {
      return;
    }

    this.db!.exec('DELETE FROM search_index_fts');
    const rows = this.db!.prepare(`SELECT ${searchIndexSelectColumns()} FROM search_index`).all() as SearchIndexRow[];
    const insertMany = this.db!.transaction((items: SearchIndexRow[]) => {
      for (const row of items) {
        this.insertFts(
          row.id,
          row.type === 'class' ? 'class' : 'method',
          row.file,
          row.name,
          row.class ?? undefined,
          row.sig ?? undefined,
          row.insight ?? undefined,
          parseJsonArray(row.refs),
          {
            namespace: row.namespace ?? undefined,
            decorators: parseJsonArray(row.decorators),
            visibility: row.visibility ?? undefined,
            isAsync: row.is_async === null ? undefined : Boolean(row.is_async),
            isStatic: row.is_static === null ? undefined : Boolean(row.is_static),
            parameters: parseJsonArray(row.parameters),
            returnType: row.return_type ?? undefined,
            extends: row.extends_name ?? undefined,
            implements: parseJsonArray(row.implements),
            imports: parseJsonArray(row.imports),
            exports: parseJsonArray(row.exports),
          },
        );
      }
    });
    insertMany(rows);
  }
}

function buildFtsQuery(query: string): string {
  const terms = searchableTerms(query).slice(0, 8);
  if (terms.length === 0) {
    return '';
  }

  const prefixTerms = terms.map(term => `${term}*`);
  if (prefixTerms.length === 1) {
    return prefixTerms[0];
  }

  return `(${prefixTerms.join(' AND ')}) OR (${prefixTerms.join(' OR ')})`;
}

function normalizeFtsRank(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 0;
  }
  return 1 / (1 + Math.max(0, Math.abs(rank)));
}

function exactSearchFieldExpressions(): string[] {
  return [
    'LOWER(name)',
    "LOWER(COALESCE(class, ''))",
    "LOWER(COALESCE(sig, ''))",
    'LOWER(file)',
    "LOWER(COALESCE(insight, ''))",
    "LOWER(COALESCE(refs, ''))",
    "LOWER(COALESCE(namespace, ''))",
    "LOWER(COALESCE(decorators, ''))",
    "LOWER(COALESCE(parameters, ''))",
    "LOWER(COALESCE(return_type, ''))",
    "LOWER(COALESCE(extends_name, ''))",
    "LOWER(COALESCE(implements, ''))",
    "LOWER(COALESCE(imports, ''))",
    "LOWER(COALESCE(exports, ''))",
    "LOWER(COALESCE(class, '') || '.' || name)",
    "LOWER(COALESCE(class, '') || '#' || name)",
    "LOWER(COALESCE(namespace, '') || '.' || name)",
  ];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function scoreExactRow(query: string, row: SearchIndexRow): number {
  const q = query.toLowerCase();
  const compactQuery = compactToken(query);
  const terms = searchableTerms(query);
  const name = row.name.toLowerCase();
  const className = row.class?.toLowerCase() ?? '';
  const qualifiedDot = className ? `${className}.${name}` : name;
  const qualifiedHash = className ? `${className}#${name}` : name;
  const namespaceName = row.namespace ? `${row.namespace.toLowerCase()}.${name}` : name;
  const content = [
    row.file,
    row.name,
    row.class,
    row.sig,
    row.insight,
    row.refs,
    row.namespace,
    row.decorators,
    row.parameters,
    row.return_type,
    row.extends_name,
    row.implements,
    row.imports,
    row.exports,
  ].filter(Boolean).join(' ').toLowerCase();
  const contentTerms = new Set(searchableTerms(content));
  let score = 0;

  if (name === q) score += 10;
  if (className === q) score += 9;
  if (qualifiedDot === q || qualifiedHash === q || namespaceName === q) score += 12;
  if (compactToken(row.name) === compactQuery || compactToken(row.class ?? '') === compactQuery) score += 7;
  if (compactToken(qualifiedDot) === compactQuery || compactToken(qualifiedHash) === compactQuery) score += 9;
  if (name.startsWith(q) || className.startsWith(q)) score += 5;
  if (row.sig?.toLowerCase().includes(q)) score += 3;
  if (row.file.toLowerCase().includes(q)) score += 2;
  if (row.insight?.toLowerCase().includes(q)) score += 2;
  if (row.refs?.toLowerCase().includes(q)) score += 1.5;

  const matchedTerms = terms.filter(term => contentTerms.has(term)).length;
  if (terms.length > 0) {
    score += (matchedTerms / terms.length) * 3;
    if (matchedTerms === terms.length) {
      score += 2;
    }
  }

  if (row.type === 'method') score += 0.3;
  if (row.type === 'class') score += 0.2;
  return Number(score.toFixed(6));
}

function buildSearchContent(input: {
  file: string;
  name: string;
  className?: string;
  sig?: string;
  insight?: string;
  refs?: string[];
  metadata?: SymbolIndexMetadata;
}): string {
  const metadata = input.metadata;
  const values = [
    input.file,
    path.basename(input.file, path.extname(input.file)),
    input.name,
    splitIdentifier(input.name),
    input.className,
    input.className ? splitIdentifier(input.className) : undefined,
    input.className ? `${input.className}.${input.name}` : undefined,
    input.className ? `${input.className}#${input.name}` : undefined,
    input.sig,
    input.insight,
    ...(input.refs ?? []),
    metadata?.namespace,
    ...(metadata?.decorators ?? []),
    metadata?.visibility,
    metadata?.isAsync ? 'async asynchronous promise task' : undefined,
    metadata?.isStatic ? 'static' : undefined,
    ...(metadata?.parameters ?? []),
    metadata?.returnType,
    metadata?.extends,
    ...(metadata?.implements ?? []),
    ...(metadata?.imports ?? []),
    ...(metadata?.exports ?? []),
  ];

  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap(value => [value, splitIdentifier(value)])
    .join(' ');
}

function searchableTerms(value: string): string[] {
  const expanded = splitIdentifier(value);
  const terms = expanded
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 1 && term.length < 64 && !isSearchStopWord(term));
  return [...new Set(terms)];
}

function splitIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[._#:/\\-]+/g, ' ');
}

function compactToken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
}

interface SearchIndexRow {
  id: string;
  type: string;
  file: string;
  name: string;
  class: string | null;
  sig: string | null;
  loc: string | null;
  insight: string | null;
  generation_id: string | null;
  namespace: string | null;
  decorators: string | null;
  visibility: string | null;
  is_async: number | null;
  is_static: number | null;
  parameters: string | null;
  return_type: string | null;
  extends_name: string | null;
  implements: string | null;
  imports: string | null;
  exports: string | null;
  refs: string | null;
}

interface StateReferenceRow {
  file: string;
  path: string;
  range: string;
  kind: string;
  symbol: string | null;
  symbol_id: string | null;
  context: string | null;
  generation_id: string | null;
}

function mapStateReferenceRow(row: StateReferenceRow): StateReference {
  return {
    file: row.file,
    path: row.path,
    range: row.range,
    kind: row.kind === 'write' ? 'write' : 'read',
    symbol: row.symbol ?? undefined,
    symbolId: row.symbol_id ?? undefined,
    context: row.context ?? undefined,
    generationId: row.generation_id ?? undefined,
  };
}

function searchIndexSelectColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    'id', 'type', 'file', 'name', 'class', 'sig', 'loc', 'insight', 'generation_id',
    'namespace', 'decorators', 'visibility', 'is_async', 'is_static', 'parameters',
    'return_type', 'extends_name', 'implements', 'imports', 'exports', 'refs',
  ].map(column => `${prefix}${column}`).join(', ');
}

function mapSearchIndexRow(row: SearchIndexRow): SearchResult {
  return {
    id: row.id,
    type: row.type as 'method' | 'class',
    file: row.file,
    method: row.type === 'method' ? row.name : undefined,
    class: row.class ?? undefined,
    sig: row.sig ?? undefined,
    loc: row.loc ?? undefined,
    insight: row.insight ?? undefined,
    generationId: row.generation_id ?? undefined,
    namespace: row.namespace ?? undefined,
    decorators: parseJsonArray(row.decorators),
    visibility: row.visibility ?? undefined,
    isAsync: row.is_async === null ? undefined : Boolean(row.is_async),
    isStatic: row.is_static === null ? undefined : Boolean(row.is_static),
    parameters: parseJsonArray(row.parameters),
    returnType: row.return_type ?? undefined,
    extends: row.extends_name ?? undefined,
    implements: parseJsonArray(row.implements),
    imports: parseJsonArray(row.imports),
    exports: parseJsonArray(row.exports),
    refs: parseJsonArray(row.refs),
  };
}

function stringifyJson(value: unknown[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null;
}

function parseJsonArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : undefined;
  } catch {
    return undefined;
  }
}
