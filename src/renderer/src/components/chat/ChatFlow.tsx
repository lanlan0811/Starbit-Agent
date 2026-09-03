import { useAppStore } from '../../stores/app'
import { MessageRenderer } from './MessageRenderer'
import './flow.css'

export function ChatFlow(): JSX.Element {
  const events = useAppStore((s) => s.events)

  return (
    <div className="chat-flow">
      {events.length === 0 ? (
        <div className="chat-flow__empty">
          <div className="chat-flow__empty-title">衔星 | Starbit</div>
          <div className="chat-flow__empty-hint">选择或新建一个工作区，开始对话</div>
        </div>
      ) : (
        <div className="chat-flow__list">
          {events.map((ev) => (
            <MessageRenderer key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  )
}
