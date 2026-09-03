import type { AssistantMessageEvent } from '@core/events'
import { Markdown } from '../../markdown/Markdown'

export function AssistantMessage({ event }: { event: AssistantMessageEvent }): JSX.Element {
  if (!event.text && event.toolCalls.length === 0) return <></>
  return (
    <div className="msg msg--assistant">
      <div className="msg__assistant-content">
        {event.toolCalls.length > 0 && (
          <div className="msg__tool-strip">
            {event.toolCalls.map((tc) => (
              <span key={tc.id} className="msg__tool-chip">
                {tc.name}
              </span>
            ))}
          </div>
        )}
        {event.text && <Markdown content={event.text} />}
      </div>
    </div>
  )
}
