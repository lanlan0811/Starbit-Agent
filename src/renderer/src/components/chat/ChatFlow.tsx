import { useAppStore } from '../../stores/app'
import { MessageRenderer } from './MessageRenderer'
import { Markdown } from '../markdown/Markdown'
import './flow.css'

export function ChatFlow(): JSX.Element {
  const events = useAppStore((s) => s.events)
  const streamingText = useAppStore((s) => s.streamingText)
  const streamingThinking = useAppStore((s) => s.streamingThinking)

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
          {(streamingText || streamingThinking) && <div className="msg msg--assistant msg--streaming" aria-live="polite">
            {streamingThinking && <details className="streaming-thinking"><summary>正在思考</summary><p>{streamingThinking}</p></details>}
            {streamingText && <div className="msg__assistant-content"><Markdown content={streamingText} /></div>}
          </div>}
        </div>
      )}
    </div>
  )
}
