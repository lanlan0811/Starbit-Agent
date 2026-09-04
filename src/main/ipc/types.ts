import type { SessionMeta } from '@core/session'
import type { SessionEvent } from '@core/events'
import type { PermissionMode } from '@core/events'
import { ModelConfig } from '@core/models'
import type { ContentPart } from '@core/events'
import type { ThinkingLevel } from '@core/models'
import type { RuleScope, PermissionRule } from '@core/permission/rules'
import type { PermissionPromptDto } from '../agent/manager'

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
    configured(): Promise<Record<string, boolean>>
    setApiKey(modelId: string, apiKey: string): Promise<void>
    testConnection(modelId: string): Promise<{ ok: boolean; latencyMs: number; message: string }>
  }
  agent: {
    send(sessionId: string, content: string, attachments?: ContentPart[], thinkingLevel?: ThinkingLevel): Promise<void>
    cancel(sessionId: string): Promise<void>
  }
  permission: {
    respond(requestId: string, outcome: 'allow' | 'deny', scope: RuleScope, reason?: string): Promise<boolean>
    listRules(): Promise<PermissionRule[]>
    deleteRule(id: string): Promise<void>
  }
  usage: {
    summary(sessionId?: string): Promise<UsageSummaryDto>
  }
  audit: {
    list(limit?: number, sessionId?: string): Promise<AuditDto[]>
  }
  settings: {
    getShell(): Promise<{ executable: string; args: string[] }>
    setShell(shell: { executable: string; args: string[] }): Promise<void>
  }
  skills: {
    list(workspacePath: string): Promise<Array<{ name: string; description: string; root: string; markdownPath: string; scripts: string[]; scope: 'user' | 'workspace' }>>
  }
  workspace: {
    selectFolder(): Promise<{ path: string } | null>
  }
}

export interface UsageSummaryDto {
  promptTokens: number
  cachedTokens: number
  uncachedTokens: number
  outputTokens: number
  hitRate: number
  avoidableMisses: number
  ttlMisses: number
  compactionMisses: number
}

export interface AuditDto {
  id: string
  sessionId?: string
  action: string
  detail?: string
  createdAt: number
}

/** 主进程 → 渲染进程的推送事件通道 */
export type MainToRendererEvent =
  | { type: 'session/event'; sessionId: string; event: SessionEvent }
  | { type: 'session/created'; session: SessionMeta }
  | { type: 'agent/status'; sessionId: string; status: 'idle' | 'running' | 'waiting-confirmation' }
  | { type: 'permission/request'; sessionId: string; request: PermissionPromptDto }
