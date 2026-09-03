import { RefreshCw } from 'lucide-react'
import type { ErrorEvent } from '@core/events'

export function ErrorMessage({ event }: { event: ErrorEvent }): JSX.Element {
  return (
    <div className="msg msg--error">
      <div className="msg__error-bar">{event.message}</div>
      {event.retriable && (
        <button className="msg__retry">
          <RefreshCw size={13} />
          重试
        </button>
      )}
    </div>
  )
}
