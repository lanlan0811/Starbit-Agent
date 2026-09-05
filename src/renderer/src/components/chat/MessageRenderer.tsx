import type { SessionEvent, ToolCall } from '@core/events'
import { UserMessage } from './messages/UserMessage'
import { AssistantMessage } from './messages/AssistantMessage'
import { ThinkingBlock } from './messages/ThinkingBlock'
import { ToolMessage } from './messages/ToolMessage'
import { CompactionBanner } from './messages/CompactionBanner'
import { ErrorMessage } from './messages/ErrorMessage'

export function MessageRenderer({ event, toolCalls = {} }: { event: SessionEvent; toolCalls?: Record<string, ToolCall> }): JSX.Element | null {
  switch (event.type) {
    case 'userMessage':
      return <UserMessage event={event} />
    case 'assistantMessage':
      return <AssistantMessage event={event} />
    case 'thinking':
      return <ThinkingBlock event={event} />
    case 'toolResult':
      return <ToolMessage event={event} toolCalls={toolCalls} />
    case 'compaction':
      return <CompactionBanner event={event} />
    case 'error':
      return <ErrorMessage event={event} />
    case 'usage':
      return <div className="message-usage">输入 {event.promptTokens.toLocaleString()} · 命中 {event.cachedTokens.toLocaleString()} · 未命中 {Math.max(0, event.promptTokens - event.cachedTokens).toLocaleString()} · 输出 {event.outputTokens.toLocaleString()} · {(event.hitRate * 100).toFixed(1)}%</div>
    default:
      return null
  }
}
