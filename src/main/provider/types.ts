import type { ContextMessage } from '@core/context'
import type { ApiShape, ModelConfig, ThinkingLevel } from '@core/models'
import type { JsonValue } from '@core/types'

export type ProviderRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

export type ProviderMessage = ContextMessage

export interface ProviderAssistantToolCall {
  id: string
  name: string
  arguments: string
}

export interface ProviderTool {
  name: string
  description: string
  parameters: JsonValue
  strict?: boolean
}

export interface ProviderRequest {
  model: ModelConfig
  apiKey: string
  messages: ProviderMessage[]
  tools?: ProviderTool[]
  thinkingLevel: ThinkingLevel
  maxOutputTokens?: number
  sampling?: Record<string, JsonValue>
  promptCacheKey?: string
  signal?: AbortSignal
  /** 抽帧降级：模型 videoStrategy=image-frames 时由请求层调用 */
  extractVideoFrames?: (source: string, mimeType?: string) => Promise<string[]>
}

export interface NormalizedUsage {
  promptTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  outputTokens: number
  hitRate: number
}

export type ProviderStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call-delta'; index: number; id?: string; name?: string; argumentsDelta: string }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'done'; responseId?: string }

export interface PreparedProviderRequest {
  url: string
  init: RequestInit
  apiShape: ApiShape
}

export interface MediaResolver {
  (source: string, mimeType?: string): Promise<string>
}

export interface PrefixSections {
  system: JsonValue
  tools: JsonValue
  skills: JsonValue
}

export interface PrefixComparison {
  fingerprint: string
  changed: boolean
  changedSections: Array<keyof PrefixSections>
}
