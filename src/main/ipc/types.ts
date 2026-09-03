import type { SessionMeta } from '../session/manager'
import type { SessionEvent } from '@core/events'
import type { PermissionMode } from '@core/events'
import { ModelConfig } from '@core/models'

/**
 * IPC API 契约 —— 主进程暴露给渲染进程的能力。
 * preload 通过 contextBridge 暴露同名对象。
 */

export interface AppInfo {
  version: string
  platform: string
  isDev: boolean
}

export interface IpcApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  session: {
    create(workspacePath: string, opts?: { title?: string; model?: string; mode?: PermissionMode }): Promise<SessionMeta>
    list(): Promise<SessionMeta[]>
    get(id: string): Promise<SessionMeta | null>
    update(id: string, patch: Partial<Pick<SessionMeta, 'title' | 'mode' | 'model'>>): Promise<void>
    replay(id: string): Promise<SessionEvent[]>
  }
  models: {
    list(): Promise<ModelConfig[]>
  }
  workspace: {
    selectFolder(): Promise<{ path: string } | null>
  }
}

/** 主进程 → 渲染进程的推送事件通道 */
export type MainToRendererEvent =
  | { type: 'session/event'; sessionId: string; event: SessionEvent }
  | { type: 'session/created'; session: SessionMeta }
  | { type: 'agent/status'; sessionId: string; status: string }
  | { type: 'permission/request'; sessionId: string; request: unknown }
