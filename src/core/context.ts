import type { ContentPart } from './events'

/** 可持久化的模型上下文，供 Provider 与压缩事件共享。 */
export interface ContextMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  name?: string
  toolCallId?: string
  reasoningContent?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}
