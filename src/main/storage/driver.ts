import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 同步 SQLite 存储驱动 —— better-sqlite3 优先（计划 §5.2 指定引擎），加载失败时
 * 回退 sql.js（WASM，纯 JS 无原生依赖）。回退保证：原生模块与当前运行时 ABI
 * 不匹配（开发期 Electron、原生编译缺失）时应用仍完整可用，只是失去
 * sqlite-vec 扩展能力（上层已有 JS 余弦降级路径）。
 */

export type SqlParam = string | number | bigint | Uint8Array | Buffer | null

export interface SyncDatabaseDriver {
  readonly kind: 'better-sqlite3' | 'sql.js'
  /** 多语句 DDL / 事务控制 */
  exec(sql: string): void
  run(sql: string, params?: SqlParam[]): void
  all<T>(sql: string, params?: SqlParam[]): T[]
  get<T>(sql: string, params?: SqlParam[]): T | undefined
  /** 整库序列化（全量备份导出） */
  serialize(): Uint8Array
  /** better-sqlite3 原生句柄（供 sqlite-vec loadExtension 使用）；sql.js 驱动为 null */
  readonly nativeHandle: unknown
  readonly supportsExtensions: boolean
  close(): void
}

const nodeRequire = createRequire(import.meta.url)

interface BetterSqlite3Database {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
  serialize?(): Buffer
  loadExtension?(path: string): void
  close(): void
}

type BetterSqlite3Constructor = new (path: string | Buffer, options?: Record<string, unknown>) => BetterSqlite3Database

interface SqlJsStatement {
  bind(params: unknown[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): boolean
}

interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
  prepare(sql: string): SqlJsStatement
  export(): Uint8Array
  close(): void
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase
}

function locateSqlJsWasm(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    nodeRequire.resolve('sql.js/dist/sql-wasm.wasm')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? candidates[candidates.length - 1]
}

function loadSqlJs(): Promise<SqlJsStatic> {
  return nodeRequire('sql.js')({ locateFile: locateSqlJsWasm })
}

class BetterSqliteDriver implements SyncDatabaseDriver {
  readonly kind = 'better-sqlite3' as const
  readonly supportsExtensions = true

  constructor(private readonly database: BetterSqlite3Database) {}

  exec(sql: string): void {
    this.database.exec(sql)
  }

  run(sql: string, params: SqlParam[] = []): void {
    this.database.prepare(sql).run(...params)
  }

  all<T>(sql: string, params: SqlParam[] = []): T[] {
    return this.database.prepare(sql).all(...params) as T[]
  }

  get<T>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined
  }

  serialize(): Uint8Array {
    if (typeof this.database.serialize !== 'function') throw new Error('当前 better-sqlite3 不支持整库序列化')
    return new Uint8Array(this.database.serialize())
  }

  get nativeHandle(): unknown {
    return this.database
  }

  close(): void {
    this.database.close()
  }
}

class SqlJsDriver implements SyncDatabaseDriver {
  readonly kind = 'sql.js' as const
  readonly supportsExtensions = false
  readonly nativeHandle = null
  private inTransaction = false

  constructor(
    private readonly database: SqlJsDatabase,
    private readonly filePath: string | null
  ) {}

  exec(sql: string): void {
    const trimmed = sql.trim().toUpperCase()
    if (trimmed.startsWith('BEGIN')) this.inTransaction = true
    this.database.exec(sql)
    if (trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
      this.inTransaction = false
      this.persist()
    } else if (!this.inTransaction) {
      this.persist()
    }
  }

  run(sql: string, params: SqlParam[] = []): void {
    const trimmed = sql.trim().toUpperCase()
    if (trimmed.startsWith('BEGIN')) this.inTransaction = true
    const statement = this.database.prepare(sql)
    try {
      statement.bind(params as unknown[])
      statement.step()
    } finally {
      statement.free()
    }
    if (trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
      this.inTransaction = false
      if (trimmed.startsWith('COMMIT')) this.persist()
    } else if (!this.inTransaction) {
      this.persist()
    }
  }

  all<T>(sql: string, params: SqlParam[] = []): T[] {
    const statement = this.database.prepare(sql)
    const rows: T[] = []
    try {
      statement.bind(params as unknown[])
      while (statement.step()) rows.push(statement.getAsObject() as T)
    } finally {
      statement.free()
    }
    return rows
  }

  get<T>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  serialize(): Uint8Array {
    return this.database.export()
  }

  close(): void {
    this.persist()
    this.database.close()
  }

  private persist(): void {
    if (!this.filePath) return
    // 延迟 require 避免模块顶层 IO
    const { mkdirSync, writeFileSync } = nodeRequire('node:fs') as typeof import('node:fs')
    const { dirname } = nodeRequire('node:path') as typeof import('node:path')
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, Buffer.from(this.database.export()))
  }
}

/**
 * 打开同步 SQLite 驱动。better-sqlite3 加载失败（ABI 不匹配/缺失）时静默回退
 * sql.js；`:memory:` 与字节初始化两种形态均支持。
 */
export async function openSyncDatabase(options: { path: string; initialBytes?: Uint8Array }): Promise<SyncDatabaseDriver> {
  try {
    const Database = nodeRequire('better-sqlite3') as BetterSqlite3Constructor
    // enableLoadExtension 为运行时选项；类型包可能缺省
    const database = new Database(options.path === ':memory:' ? ':memory:' : options.path, { enableLoadExtension: true })
    return new BetterSqliteDriver(database)
  } catch {
    // 原生模块不可用：回退 sql.js
  }
  const SQL = await loadSqlJs()
  const initial = options.initialBytes ?? (options.path !== ':memory:' && existsSync(options.path) ? new Uint8Array(nodeRequire('node:fs').readFileSync(options.path)) : undefined)
  const database = new SQL.Database(initial)
  return new SqlJsDriver(database, options.path === ':memory:' ? null : options.path)
}

/** 从字节序列打开驱动（全量数据导入）。 */
export async function openSyncDatabaseFromBytes(bytes: Uint8Array): Promise<SyncDatabaseDriver> {
  try {
    const Database = nodeRequire('better-sqlite3') as BetterSqlite3Constructor
    const database = new Database(Buffer.from(bytes), { enableLoadExtension: true })
    return new BetterSqliteDriver(database)
  } catch {
    // 回退 sql.js
  }
  const SQL = await loadSqlJs()
  return new SqlJsDriver(new SQL.Database(bytes), null)
}
