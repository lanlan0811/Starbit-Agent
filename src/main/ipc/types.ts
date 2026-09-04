import type { SessionMeta } from '@core/session'
import type { SessionEvent } from '@core/events'
import type { PermissionMode } from '@core/events'
import { ModelConfig } from '@core/models'
import type { ContentPart } from '@core/events'
import type { ThinkingLevel } from '@core/models'
import type { RuleScope, PermissionRule } from '@core/permission/rules'
import type { PermissionPromptDto } from '../agent/manager'
import type { BrowserBounds, BrowserControlMode, BrowserDownloadState, BrowserState, BrowserTabState } from '../browser/types'
import type { KnowledgeBaseRecord, KnowledgeDocumentRecord, KnowledgeSearchHit } from '../knowledge/types'
import type { KnowledgeSettings } from '../agent/manager'
import type { MemoryEntry, MemoryScope, MemorySearchHit } from '../memory/types'

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
  mcp: {
    list(): Promise<McpServerStateDto[]>
    set(configs: McpServerConfigDto[]): Promise<McpServerStateDto[]>
  }
  terminal: {
    create(sessionId: string, cols?: number, rows?: number): Promise<void>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    close(sessionId: string): Promise<void>
  }
  browser: {
    getState(sessionId: string): Promise<BrowserState>
    createTab(sessionId: string, url?: string): Promise<BrowserTabState>
    closeTab(sessionId: string, tabId: string): Promise<BrowserState>
    activateTab(sessionId: string, tabId: string): Promise<BrowserState>
    navigate(sessionId: string, url: string, tabId?: string, newTab?: boolean): Promise<BrowserTabState>
    back(sessionId: string, tabId?: string): Promise<BrowserState>
    forward(sessionId: string, tabId?: string): Promise<BrowserState>
    reload(sessionId: string, tabId?: string): Promise<BrowserState>
    stop(sessionId: string, tabId?: string): Promise<BrowserState>
    setBounds(sessionId: string, bounds: BrowserBounds): Promise<BrowserState>
    hide(sessionId: string): Promise<void>
    setReuseLogin(sessionId: string, enabled: boolean): Promise<BrowserState>
    setAllowPrivateNetwork(sessionId: string, enabled: boolean): Promise<BrowserState>
    setControlMode(sessionId: string, mode: BrowserControlMode): Promise<BrowserState>
  }
  knowledge: {
    listBases(sessionId: string): Promise<KnowledgeBaseRecord[]>
    createBase(sessionId: string, name: string, description?: string): Promise<KnowledgeBaseRecord>
    deleteBase(sessionId: string, id: string): Promise<boolean>
    listDocuments(sessionId: string, knowledgeBaseId?: string): Promise<KnowledgeDocumentRecord[]>
    selectAndImport(sessionId: string, knowledgeBaseId: string): Promise<KnowledgeDocumentRecord[]>
    importUrl(sessionId: string, knowledgeBaseId: string, url: string): Promise<KnowledgeDocumentRecord>
    deleteDocument(sessionId: string, id: string): Promise<boolean>
    rebuild(sessionId: string, knowledgeBaseId: string): Promise<KnowledgeDocumentRecord[]>
    search(sessionId: string, query: string, knowledgeBaseId?: string): Promise<KnowledgeSearchHit[]>
    getSettings(): Promise<KnowledgeSettings>
    setSettings(settings: Partial<Omit<KnowledgeSettings, 'apiKeyConfigured'>>, apiKey?: string): Promise<KnowledgeSettings>
  }
  memory: {
    list(sessionId: string, scope?: MemoryScope): Promise<MemoryEntry[]>
    add(sessionId: string, scope: MemoryScope, content: string): Promise<MemoryEntry>
    update(sessionId: string, id: string, content: string): Promise<MemoryEntry>
    delete(sessionId: string, id: string): Promise<boolean>
    search(sessionId: string, query: string, scope?: MemoryScope): Promise<MemorySearchHit[]>
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

export type McpTransportDto =
  | { type: 'stdio'; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  | { type: 'streamable-http'; url: string; headers?: Record<string, string>; fallbackToSse?: boolean }
  | { type: 'sse'; url: string; headers?: Record<string, string> }

export interface McpServerConfigDto {
  id: string
  name: string
  enabled: boolean
  transport: McpTransportDto
  disabledTools?: string[]
}

export interface McpServerStateDto {
  config: McpServerConfigDto
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: Array<{ name: string; title?: string; description?: string }>
  error?: string
}

/** 主进程 → 渲染进程的推送事件通道 */
export type MainToRendererEvent =
  | { type: 'session/event'; sessionId: string; event: SessionEvent }
  | { type: 'session/created'; session: SessionMeta }
  | { type: 'agent/status'; sessionId: string; status: 'idle' | 'running' | 'waiting-confirmation' }
  | { type: 'permission/request'; sessionId: string; request: PermissionPromptDto }
  | { type: 'terminal/data'; terminalId: string; data: string }
  | { type: 'terminal/ready'; terminalId: string; pid: number }
  | { type: 'terminal/exit'; terminalId: string; exitCode: number; signal?: number }
  | { type: 'terminal/error'; terminalId: string; message: string }
  | { type: 'browser/state'; state: BrowserState }
  | { type: 'browser/show'; sessionId: string }
  | { type: 'browser/download'; download: BrowserDownloadState }
  | { type: 'browser/error'; sessionId: string; message: string }
