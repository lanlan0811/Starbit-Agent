import initSqlJs, { type Database } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { SessionEvent } from '@core/events'

/**
 * SQLite 数据库层 —— 全本地存储（sql.js，纯 JS/WASM，无原生编译依赖）。
 * 表：sessions（会话）、events（append-only 事件日志）、whitelist（权限白名单）、
 *      usage（用量统计）、audit_log（审计日志）、settings（设置）。
 *
 * sql.js 以内存数据库 + 磁盘文件同步的方式工作，提供 export() 将整个库
 * 序列化落盘。为满足"全本地持久化"，采用
 * 写后立即 export 落盘策略（数据量小、桌面端可接受）。
 */

let db: Database | null = null
let dbPath = ''
const nodeRequire = createRequire(import.meta.url)

function userDataDir(): string {
  const dir = join(app.getPath('userData'))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 定位 sql.js 的 WASM 文件路径 */
function locateWasmFile(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    join(__dirname, '..', '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    nodeRequire.resolve('sql.js/dist/sql-wasm.wasm')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return ''
}

export async function initDatabase(): Promise<Database> {
  if (db) return db
  dbPath = join(userDataDir(), 'starbit.db')
  const SQL = await initSqlJs({ locateFile: locateWasmFile })
  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath))
  } else {
    db = new SQL.Database()
    migrate()
    persist()
  }
  migrate()
  return db
}

export function getDb(): Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

/** 将内存库落盘 */
export function persist(): void {
  if (!db) return
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

function migrate(): void {
  const d = getDb()
  d.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'fullAccess',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);

    CREATE TABLE IF NOT EXISTS whitelist (
      id TEXT PRIMARY KEY,
      semantic_label TEXT NOT NULL,
      pattern TEXT NOT NULL,
      action TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      hit_rate REAL NOT NULL,
      miss_category TEXT,
      is_subagent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

/** 通用查询辅助 */
function all<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params as never[])
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return all<T>(sql, params)[0]
}

function run(sql: string, params: unknown[] = []): void {
  const stmt = getDb().prepare(sql)
  stmt.bind(params as never[])
  stmt.step()
  stmt.free()
}

export interface SessionRow {
  id: string
  title: string
  workspace_path: string
  mode: string
  model: string
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: string
  session_id: string
  seq: number
  type: string
  payload: string
  created_at: number
}

export interface UsageSummary {
  promptTokens: number
  cachedTokens: number
  uncachedTokens: number
  outputTokens: number
  hitRate: number
  avoidableMisses: number
  ttlMisses: number
  compactionMisses: number
}

export interface AuditRow {
  id: string
  sessionId?: string
  action: string
  detail?: string
  createdAt: number
}

export function createSessionRow(row: Omit<SessionRow, 'created_at' | 'updated_at'>): void {
  const ts = Date.now()
  run(
    `INSERT INTO sessions (id, title, workspace_path, mode, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.title, row.workspace_path, row.mode, row.model, ts, ts]
  )
  persist()
}

export function listSessions(): SessionRow[] {
  return all<SessionRow>('SELECT * FROM sessions ORDER BY updated_at DESC')
}

export function getSession(id: string): SessionRow | undefined {
  return get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id])
}

export function updateSession(id: string, patch: Partial<Pick<SessionRow, 'title' | 'mode' | 'model'>>): void {
  const current = getSession(id)
  if (!current) return
  run('UPDATE sessions SET title = ?, mode = ?, model = ?, updated_at = ? WHERE id = ?', [
    patch.title ?? current.title,
    patch.mode ?? current.mode,
    patch.model ?? current.model,
    Date.now(),
    id
  ])
  persist()
}

export function appendEvent(sessionId: string, event: SessionEvent): number {
  const { n } = get<{ n: number }>('SELECT COUNT(*) as n FROM events WHERE session_id = ?', [sessionId]) ?? { n: 0 }
  const seq = n + 1
  run('INSERT INTO events (id, session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    event.id,
    sessionId,
    seq,
    event.type,
    JSON.stringify(event),
    event.createdAt
  ])
  return seq
}

export function appendEvents(sessionId: string, events: SessionEvent[]): void {
  for (const e of events) appendEvent(sessionId, e)
  persist()
}

export function listEvents(sessionId: string): SessionEvent[] {
  const rows = all<{ payload: string }>('SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC', [sessionId])
  return rows.map((r) => JSON.parse(r.payload) as SessionEvent)
}

export function recordUsage(usage: {
  id: string
  sessionId?: string
  model: string
  promptTokens: number
  cachedTokens: number
  outputTokens: number
  hitRate: number
  missCategory?: string
  isSubagent?: boolean
}): void {
  run(
    `INSERT INTO usage (id, session_id, model, prompt_tokens, cached_tokens, output_tokens, hit_rate, miss_category, is_subagent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      usage.id,
      usage.sessionId ?? null,
      usage.model,
      usage.promptTokens,
      usage.cachedTokens,
      usage.outputTokens,
      usage.hitRate,
      usage.missCategory ?? null,
      usage.isSubagent ? 1 : 0,
      Date.now()
    ]
  )
  persist()
}

export function getUsageSummary(sessionId?: string): UsageSummary {
  const where = sessionId ? 'WHERE session_id = ? AND is_subagent = 0' : 'WHERE is_subagent = 0'
  const params = sessionId ? [sessionId] : []
  const row = get<{
    prompt_tokens: number
    cached_tokens: number
    output_tokens: number
    avoidable: number
    ttl: number
    compaction: number
  }>(
    `SELECT
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(CASE WHEN miss_category = 'avoidable' THEN 1 ELSE 0 END), 0) AS avoidable,
      COALESCE(SUM(CASE WHEN miss_category = 'ttl' THEN 1 ELSE 0 END), 0) AS ttl,
      COALESCE(SUM(CASE WHEN miss_category = 'compaction' THEN 1 ELSE 0 END), 0) AS compaction
     FROM usage ${where}`,
    params
  )
  const promptTokens = row?.prompt_tokens ?? 0
  const cachedTokens = row?.cached_tokens ?? 0
  return {
    promptTokens,
    cachedTokens,
    uncachedTokens: Math.max(0, promptTokens - cachedTokens),
    outputTokens: row?.output_tokens ?? 0,
    hitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
    avoidableMisses: row?.avoidable ?? 0,
    ttlMisses: row?.ttl ?? 0,
    compactionMisses: row?.compaction ?? 0
  }
}

export function writeAudit(action: string, detail?: string, sessionId?: string): void {
  run('INSERT INTO audit_log (id, session_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId ?? null,
    action,
    detail ?? null,
    Date.now()
  ])
  persist()
}

export function listAudit(limit = 200, sessionId?: string): AuditRow[] {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)))
  const rows = sessionId
    ? all<{ id: string; session_id?: string; action: string; detail?: string; created_at: number }>(
        'SELECT * FROM audit_log WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
        [sessionId, safeLimit]
      )
    : all<{ id: string; session_id?: string; action: string; detail?: string; created_at: number }>(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?',
        [safeLimit]
      )
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id, action: row.action, detail: row.detail, createdAt: row.created_at }))
}

export function listWhitelist(): import('@core/permission/rules').PermissionRule[] {
  return all<{
    id: string
    semantic_label: string
    pattern: string
    action: import('@core/permission/rules').RuleAction
    scope: import('@core/permission/rules').RuleScope
    created_at: number
    hit_count: number
  }>('SELECT * FROM whitelist ORDER BY created_at ASC').map((row) => ({
    id: row.id,
    semanticLabel: row.semantic_label,
    pattern: row.pattern,
    action: row.action,
    scope: row.scope,
    createdAt: row.created_at,
    hitCount: row.hit_count
  }))
}

export function upsertWhitelist(rule: import('@core/permission/rules').PermissionRule): void {
  run(
    `INSERT OR REPLACE INTO whitelist (id, semantic_label, pattern, action, scope, created_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [rule.id, rule.semanticLabel, rule.pattern, rule.action, rule.scope, rule.createdAt, rule.hitCount ?? 0]
  )
  persist()
}

export function deleteWhitelist(id: string): void {
  run('DELETE FROM whitelist WHERE id = ?', [id])
  persist()
}

export function setSetting(key: string, value: string): void {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  persist()
}

export function getSetting(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value
}
