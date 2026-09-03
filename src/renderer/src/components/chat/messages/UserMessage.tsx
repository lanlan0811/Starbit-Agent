import type { UserMessageEvent } from '@core/events'
import { Markdown } from '../../markdown/Markdown'
import './messages.css'

export function UserMessage({ event }: { event: UserMessageEvent }): JSX.Element {
  return (
    <div className="msg">
      <div className="msg__user-bubble">
        {event.fileRefs && event.fileRefs.length > 0 && (
          <div className="msg__file-chips">
            {event.fileRefs.map((f) => (
              <span key={f} className="msg__file-chip" title={f}>
                {f}
              </span>
            ))}
          </div>
        )}
        {event.attachments && event.attachments.length > 0 && (
          <div className="msg__attachments">
            {event.attachments.map((a, i) => (
              <div key={i} className="msg__attachment">
                {a.kind === 'image' ? (
                  <img className="msg__attachment-img" src={a.source} alt="附件" />
                ) : (
                  <div className="msg__attachment-video">{a.mimeType ?? 'video'}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <Markdown content={event.content} />
      </div>
    </div>
  )
}
