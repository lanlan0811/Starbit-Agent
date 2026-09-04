import { createHash } from 'node:crypto'
import type { ModelConfig } from '@core/models'
import type { ProviderMessage } from '../provider/types'

export type CompactionLevel = 'micro' | 'full'
export type CompactionReason = 'automatic' | 'manual'

export interface ContextStatus {
  estimatedTokens: number
  contextWindow: number
  maxOutputTokens: number
  ratio: number
  level: 'normal' | 'warning' | 'critical'
}

export interface ContextManagerOptions {
  warningRatio?: number
  criticalRatio?: number
  preservedRecentMessages?: number
  toolPreviewCharacters?: number
}

const DEFAULT_WARNING_RATIO = 0.9
const DEFAULT_CRITICAL_RATIO = 0.97
const DEFAULT_PRESERVED_RECENT_MESSAGES = 12
const DEFAULT_TOOL_PREVIEW_CHARACTERS = 320

/**
 * 上下文预算与确定性压缩。Token 估算只负责提前量判断；服务端 usage
 * 仍是计费与缓存统计的权威数据。
 */
export class ContextManager {
  readonly warningRatio: number
  readonly criticalRatio: number
  readonly preservedRecentMessages: number
  private readonly toolPreviewCharacters: number

  constructor(readonly model: ModelConfig, options: ContextManagerOptions = {}) {
    this.warningRatio = ratioOption(options.warningRatio, DEFAULT_WARNING_RATIO)
    this.criticalRatio = ratioOption(options.criticalRatio, DEFAULT_CRITICAL_RATIO)
    if (this.warningRatio >= this.criticalRatio) throw new Error('上下文预警阈值必须小于硬顶阈值')
    this.preservedRecentMessages = integerOption(options.preservedRecentMessages, DEFAULT_PRESERVED_RECENT_MESSAGES, 2, 200)
    this.toolPreviewCharacters = integerOption(options.toolPreviewCharacters, DEFAULT_TOOL_PREVIEW_CHARACTERS, 64, 8_192)
  }

  inspect(messages: readonly ProviderMessage[]): ContextStatus {
    const estimatedTokens = messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
    const ratio = Math.min(1, estimatedTokens / this.model.contextWindow)
    return {
      estimatedTokens,
      contextWindow: this.model.contextWindow,
      maxOutputTokens: this.model.maxOutputTokens,
      ratio,
      level: ratio >= this.criticalRatio ? 'critical' : ratio >= this.warningRatio ? 'warning' : 'normal'
    }
  }

  /** 仅替换较早的工具结果，保留调用关系、头部预览、字节数和内容哈希。 */
  microcompact(messages: readonly ProviderMessage[]): { messages: ProviderMessage[]; changed: number } {
    const cutoff = Math.max(1, messages.length - this.preservedRecentMessages)
    let changed = 0
    const next = messages.map((message, index) => {
      if (index >= cutoff || message.role !== 'tool' || typeof message.content !== 'string') return cloneMessage(message)
      if (message.content.startsWith('[microcompacted tool result')) return cloneMessage(message)
      const full = message.content
      if (full.length <= this.toolPreviewCharacters * 2) return cloneMessage(message)
      const preview = full.slice(0, this.toolPreviewCharacters).trimEnd()
      const digest = createHash('sha256').update(full, 'utf8').digest('hex').slice(0, 16)
      changed += 1
      return {
        ...message,
        content: `[microcompacted tool result · ${Buffer.byteLength(full, 'utf8')} bytes · sha256:${digest}]\n${preview}${full.length > preview.length ? '\n[…早期工具结果已省略…]' : ''}`
      }
    })
    return { messages: next, changed }
  }

  /** 把旧历史替换为稳定摘要，同时保留最近一段完整消息。 */
  compactWithSummary(messages: readonly ProviderMessage[], summary: string): { messages: ProviderMessage[]; preservedStart: number } {
    if (!messages.length || messages[0].role !== 'system') throw new Error('上下文缺少稳定 system 前缀')
    const preservedStart = findPreservedStart(messages, this.preservedRecentMessages)
    const recent = messages.slice(preservedStart).map(cloneMessage)
    const normalizedSummary = summary.trim()
    if (!normalizedSummary) throw new Error('上下文摘要为空')
    return {
      messages: [
        cloneMessage(messages[0]),
        { role: 'system', content: `会话历史结构化摘要：\n${normalizedSummary}` },
        ...recent
      ],
      preservedStart
    }
  }
}

export function estimateMessageTokens(message: ProviderMessage): number {
  const envelope = 8
  const content = typeof message.content === 'string'
    ? message.content
    : message.content.map((part) => part.kind === 'text' ? part.text ?? '' : `${part.kind}:${part.mimeType ?? ''}:${part.source ?? ''}`).join('\n')
  const calls = message.toolCalls?.map((call) => `${call.name}\n${call.arguments}`).join('\n') ?? ''
  return envelope + estimateTextTokens(content) + estimateTextTokens(calls)
}

export function estimateTextTokens(value: string): number {
  if (!value) return 0
  let latin = 0
  let wide = 0
  for (const character of value) {
    if (/^[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(character)) wide += 1
    else latin += 1
  }
  return Math.ceil(latin / 4) + wide
}

function findPreservedStart(messages: readonly ProviderMessage[], count: number): number {
  let start = Math.max(1, messages.length - count)
  // 以完整用户轮为边界，避免切断 assistant/tool 调用组。
  while (start > 1 && messages[start]?.role !== 'user') start -= 1
  return start
}

function cloneMessage(message: ProviderMessage): ProviderMessage {
  return {
    ...message,
    content: typeof message.content === 'string' ? message.content : message.content.map((part) => ({ ...part })),
    toolCalls: message.toolCalls?.map((call) => ({ ...call }))
  }
}

function ratioOption(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > 1) throw new Error('上下文阈值必须在 0 到 1 之间')
  return resolved
}

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) throw new Error(`上下文配置必须是 ${minimum} 到 ${maximum} 之间的整数`)
  return resolved
}
