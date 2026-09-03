import type { SessionEvent } from '@core/events'
import { UserMessage } from './messages/UserMessage'
import { AssistantMessage } from './messages/AssistantMessage'
import { ThinkingBlock } from './messages/ThinkingBlock'
import { ToolMessage } from './messages/ToolMessage'
import { CompactionBanner } from './messages/CompactionBanner'
import { ErrorMessage } from './messages/ErrorMessage'

export function MessageRenderer({ event }: { event: SessionEvent }): JSX.Element | null {
  switch (event.type) {
    case 'userMessage':
      return <UserMessage event={event} />
    case 'assistantMessage':
      return <AssistantMessage event={event} />
    case 'thinking':
      return <ThinkingBlock event={event} />
    case 'toolResult':
      return <ToolMessage event={event} />
    case 'compaction':
      return <CompactionBanner event={event} />
    case 'error':
      return <ErrorMessage event={event} />
    default:
      return null
  }
}
