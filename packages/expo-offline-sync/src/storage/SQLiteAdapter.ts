import { MutationItem, MutationStatus, QueueStats, StorageAdapter } from '../types';

export interface SQLiteAdapterOptions {
  /**
   * Database filename (defaults to 'expo_offline_sync.db')
   */
  databaseName?: string;
  /**
   * Table name for the queue (defaults to 'offline_mutation_queue')
   */
  tableName?: string;
  /**
   * Direct SQLite database instance (e.g. from useSQLiteContext() or SQLite.openDatabaseAsync)
   */
  database?: any;
}

interface RawMutationRow {
  id: string;
  type: string;
  scope: string;
  payload: string;
  meta: string | null;
  status: string;
  attempt_count: number;
  max_retries: number;
  created_at: number;
  updated_at: number;
  last_error: string | null;
  idempotency_key: string;
  priority: number;
}

/**
 * High-performance Expo SQLite Storage Adapter
 * Compatible with modern Expo SDK 51/52+ SQLite API
 */
export class SQLiteAdapter implements StorageAdapter {
  private db: any = null;
  private databaseName: string;
  private tableName: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: SQLiteAdapterOptions = {}) {
    this.databaseName = options.databaseName ?? 'expo_offline_sync.db';
    this.tableName = options.tableName ?? 'offline_mutation_queue';
    if (options.database) {
      this.db = options.database;
    }
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (!this.db) {
        let SQLite: any;
        try {
          SQLite = await import('expo-sqlite');
        } catch {
          throw new Error(
            '[expo-offline-sync] expo-sqlite package is not installed. Please run "npx expo install expo-sqlite" or provide a custom StorageAdapter (e.g. MemoryAdapter).'
          );
        }

        if (typeof SQLite.openDatabaseAsync === 'function') {
          this.db = await SQLite.openDatabaseAsync(this.databaseName);
        } else if (typeof SQLite.openDatabaseSync === 'function') {
          this.db = SQLite.openDatabaseSync(this.databaseName);
        } else {
          throw new Error(
            '[expo-offline-sync] Incompatible expo-sqlite version detected. Please upgrade to Expo SDK 51 or newer.'
          );
        }
      }

      // Configure WAL mode for high concurrency
      await this.db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          scope TEXT NOT NULL,
          payload TEXT NOT NULL,
          meta TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 5,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error TEXT,
          idempotency_key TEXT NOT NULL,
          priority INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_lookup 
          ON ${this.tableName}(status, scope, priority DESC, created_at ASC);
      `);
    })();

    return this.initPromise;
  }

  private rowToItem(row: RawMutationRow): MutationItem {
    let payload: any = null;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = row.payload;
    }

    let meta: any = undefined;
    if (row.meta) {
      try {
        meta = JSON.parse(row.meta);
      } catch {
        meta = undefined;
      }
    }

    let lastError: any = undefined;
    if (row.last_error) {
      try {
        lastError = JSON.parse(row.last_error);
      } catch {
        lastError = { message: row.last_error };
      }
    }

    return {
      id: row.id,
      type: row.type,
      scope: row.scope,
      payload,
      meta,
      status: row.status as MutationStatus,
      attemptCount: row.attempt_count,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastError,
      idempotencyKey: row.idempotency_key,
      priority: row.priority,
    };
  }

  async enqueue<P = any, M = any>(item: MutationItem<P, M>): Promise<void> {
    await this.init();

    const sql = `
      INSERT OR REPLACE INTO ${this.tableName} (
        id, type, scope, payload, meta, status,
        attempt_count, max_retries, created_at, updated_at,
        last_error, idempotency_key, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      item.id,
      item.type,
      item.scope,
      JSON.stringify(item.payload),
      item.meta !== undefined ? JSON.stringify(item.meta) : null,
      item.status,
      item.attemptCount,
      item.maxRetries,
      item.createdAt,
      item.updatedAt,
      item.lastError ? JSON.stringify(item.lastError) : null,
      item.idempotencyKey,
      item.priority ?? 0,
    ];

    await this.db.runAsync(sql, params);
  }

  async getPending(scope?: string): Promise<MutationItem[]> {
    await this.init();

    let sql = `
      SELECT * FROM ${this.tableName}
      WHERE status IN ('pending', 'syncing')
    `;
    const params: any[] = [];

    if (scope) {
      sql += ` AND scope = ?`;
      params.push(scope);
    }

    sql += ` ORDER BY priority DESC, created_at ASC`;

    const rows: RawMutationRow[] = await this.db.getAllAsync(sql, params);
    return rows.map((r) => this.rowToItem(r));
  }

  async getById(id: string): Promise<MutationItem | null> {
    await this.init();

    const sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
    const row: RawMutationRow | null = await this.db.getFirstAsync(sql, [id]);
    if (!row) return null;

    return this.rowToItem(row);
  }

  async update(id: string, updates: Partial<MutationItem>): Promise<void> {
    await this.init();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.attemptCount !== undefined) {
      fields.push('attempt_count = ?');
      values.push(updates.attemptCount);
    }
    if (updates.lastError !== undefined) {
      fields.push('last_error = ?');
      values.push(updates.lastError ? JSON.stringify(updates.lastError) : null);
    }
    if (updates.payload !== undefined) {
      fields.push('payload = ?');
      values.push(JSON.stringify(updates.payload));
    }
    if (updates.meta !== undefined) {
      fields.push('meta = ?');
      values.push(updates.meta ? JSON.stringify(updates.meta) : null);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }

    fields.push('updated_at = ?');
    values.push(Date.now());

    values.push(id);

    const sql = `UPDATE ${this.tableName} SET ${fields.join(', ')} WHERE id = ?`;
    await this.db.runAsync(sql, values);
  }

  async remove(id: string): Promise<void> {
    await this.init();
    await this.db.runAsync(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
  }

  async clear(scope?: string): Promise<void> {
    await this.init();
    if (scope) {
      await this.db.runAsync(`DELETE FROM ${this.tableName} WHERE scope = ?`, [scope]);
    } else {
      await this.db.runAsync(`DELETE FROM ${this.tableName}`);
    }
  }

  async getAll(filter?: { status?: MutationStatus; scope?: string }): Promise<MutationItem[]> {
    await this.init();

    let sql = `SELECT * FROM ${this.tableName}`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.scope) {
      conditions.push('scope = ?');
      params.push(filter.scope);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` ORDER BY priority DESC, created_at ASC`;

    const rows: RawMutationRow[] = await this.db.getAllAsync(sql, params);
    return rows.map((r) => this.rowToItem(r));
  }

  async getStats(): Promise<QueueStats> {
    await this.init();

    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'syncing' THEN 1 ELSE 0 END) as syncing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM ${this.tableName}
    `;

    const row: any = await this.db.getFirstAsync(sql);

    const scopesRows: { scope: string }[] = await this.db.getAllAsync(
      `SELECT DISTINCT scope FROM ${this.tableName}`
    );

    return {
      total: row?.total ?? 0,
      pending: row?.pending ?? 0,
      syncing: row?.syncing ?? 0,
      failed: row?.failed ?? 0,
      completed: row?.completed ?? 0,
      scopes: scopesRows.map((s) => s.scope),
    };
  }
}

