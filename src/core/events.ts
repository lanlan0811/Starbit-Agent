/**
 * 事件日志 —— 会话即事件流。
 * UI 渲染、resume、审计全部由重放驱动。
 */

import type { JsonValue, SessionId, ToolCallId } from './types'

/** 权限模式 */
export type PermissionMode = 'plan' | 'acceptEdits' | 'fullAccess'

/** Agent 运行状态 */
export type AgentStatus = 'idle' | 'running' | 'waiting-confirmation'

/** 工具执行状态 */
export type ToolStatus = 'running' | 'success' | 'failed' | 'pending-confirmation' | 'rejected'

/** 工具调用结果 */
export interface ToolCallResult {
  toolCallId: ToolCallId
  status: ToolStatus
  content: string
  truncated: boolean
  /** 字节输出量，用于结果瘦身与日志落盘 */
  outputBytes?: number
  /** 实际落盘路径（大输出不直接回传，只回路径） */
  outputFile?: string
}

/** 工具调用 */
export interface ToolCall {
  id: ToolCallId
  name: string
  input: JsonValue
  raw?: string
}

/** 消息事件基类 */
interface BaseEvent {
  id: string
  sessionId: SessionId
  createdAt: number
}

/** 用户消息 */
export interface UserMessageEvent extends BaseEvent {
  type: 'userMessage'
  content: string
  /** 附件（图片/视频等） */
  attachments?: ContentPart[]
  /** @file 引用 */
  fileRefs?: string[]
}

/** 多模态内容单元 */
export interface ContentPart {
  kind: 'text' | 'image' | 'video'
  text?: string
  /** data URL 或本地路径 */
  source?: string
  mimeType?: string
}

/** 助手消息 */
export interface AssistantMessageEvent extends BaseEvent {
  type: 'assistantMessage'
  text: string
  thinking?: string
  toolCalls: ToolCall[]
}

/** 思考过程（独立事件，紫色可折叠块） */
export interface ThinkingEvent extends BaseEvent {
  type: 'thinking'
  content: string
  durationMs?: number
}

/** 工具结果 */
export interface ToolResultEvent extends BaseEvent {
  type: 'toolResult'
  result: ToolCallResult
}

/** 权限判定记录 */
export interface PermissionDecisionEvent extends BaseEvent {
  type: 'permissionDecision'
  toolCallId: ToolCallId
  mode: PermissionMode
  decision: 'allow' | 'deny' | 'ask'
  matchedRule?: string
  reason?: string
}

/** 模式切换 */
export interface ModeChangeEvent extends BaseEvent {
  type: 'modeChange'
  from: PermissionMode
  to: PermissionMode
}

/** 上下文压缩 */
export interface CompactionEvent extends BaseEvent {
  type: 'compaction'
  summary: string
  preservedRange: [number, number]
}

/** 用量事件（缓存命中率采集） */
export interface UsageEvent extends BaseEvent {
  type: 'usage'
  model: string
  promptTokens: number
  cachedTokens: number
  outputTokens: number
  hitRate: number
  /** miss 分类：可避免 / TTL / 压缩 */
  missCategory?: 'avoidable' | 'ttl' | 'compaction'
  /** 子代理独立统计 */
  isSubagent?: boolean
  requestFingerprint?: string
}

/** 错误 */
export interface ErrorEvent extends BaseEvent {
  type: 'error'
  message: string
  stack?: string
  retriable?: boolean
}

/** 检查点 */
export interface CheckpointEvent extends BaseEvent {
  type: 'checkpoint'
  description: string
}

/** 会话事件联合 */
export type SessionEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ThinkingEvent
  | ToolResultEvent
  | PermissionDecisionEvent
  | ModeChangeEvent
  | CompactionEvent
  | UsageEvent
  | ErrorEvent
  | CheckpointEvent
