import { nanoid } from '@core/nanoid'
import { PermissionMode } from '@core/events'
import type { SessionEvent } from '@core/events'
import type { SessionMeta } from '@core/session'
import {
  createSessionRow,
  getSession,
  listSessions,
  updateSession,
  appendEvents,
  listEvents,
  type SessionRow
} from './database'

/**
 * SessionManager —— 会话生命周期 + append-only 事件日志。
 * 每会话一 AgentLoop 实例（由 AgentLoopManager 管理）。
 */

export type { SessionMeta } from '@core/session'

export class SessionManager {
  private buffer: Map<string, SessionEvent[]> = new Map()

  create(workspacePath: string, opts?: { title?: string; model?: string; mode?: PermissionMode }): SessionMeta {
    const id = nanoid('session')
    const mode = opts?.mode ?? 'fullAccess'
    const meta: SessionMeta = {
      id,
      title: opts?.title ?? '新会话',
      workspacePath,
      mode,
      model: opts?.model ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    createSessionRow({
      id,
      title: meta.title,
      workspace_path: workspacePath,
      mode,
      model: meta.model
    })
    return meta
  }

  get(id: string): SessionMeta | null {
    const row = getSession(id)
    if (!row) return null
    return toMeta(row)
  }

  list(): SessionMeta[] {
    return listSessions().map(toMeta)
  }

  update(id: string, patch: Partial<Pick<SessionMeta, 'title' | 'mode' | 'model'>>): void {
    updateSession(id, {
      title: patch.title,
      mode: patch.mode,
      model: patch.model
    })
  }

  /** 追加事件（写入缓冲，批量落盘优化） */
  append(sessionId: string, event: SessionEvent): void {
    const buf = this.buffer.get(sessionId) ?? []
    buf.push(event)
    this.buffer.set(sessionId, buf)
    this.flush(sessionId)
  }

  flush(sessionId: string): void {
    const buf = this.buffer.get(sessionId)
    if (buf && buf.length > 0) {
      appendEvents(sessionId, buf)
      this.buffer.set(sessionId, [])
    }
  }

  /** 重放事件流（resume） */
  replay(sessionId: string): SessionEvent[] {
    return listEvents(sessionId)
  }
}

function toMeta(row: SessionRow): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    workspacePath: row.workspace_path,
    mode: row.mode as PermissionMode,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
