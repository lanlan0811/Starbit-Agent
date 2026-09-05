import { useMemo } from 'react'
import type { ToolCall } from '@core/events'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import { MessageRenderer } from './MessageRenderer'
import { Markdown } from '../markdown/Markdown'
import './flow.css'

export function ChatFlow(): JSX.Element {
  const { t } = useT()
  const events = useAppStore((s) => s.events)
  const streamingText = useAppStore((s) => s.streamingText)
  const streamingThinking = useAppStore((s) => s.streamingThinking)

  // 工具调用 ID → 调用详情（供工具结果卡片显示名称与输入摘要）
  const toolCalls = useMemo(() => {
    const map: Record<string, ToolCall> = {}
    for (const ev of events) {
      if (ev.type === 'assistantMessage') {
        for (const call of ev.toolCalls) map[call.id] = call
      }
    }
    return map
  }, [events])

  return (
    <div className="chat-flow">
      {events.length === 0 ? (
        <div className="chat-flow__empty">
          <div className="chat-flow__empty-title">{t('chat.emptyTitle')}</div>
          <div className="chat-flow__empty-hint">{t('chat.emptyHint')}</div>
        </div>
      ) : (
        <div className="chat-flow__list">
          {events.map((ev) => (
            <MessageRenderer key={ev.id} event={ev} toolCalls={toolCalls} />
          ))}
          {(streamingText || streamingThinking) && <div className="msg msg--assistant msg--streaming" aria-live="polite">
            {streamingThinking && <details className="streaming-thinking"><summary>{t('chat.thinking')}</summary><p>{streamingThinking}</p></details>}
            {streamingText && <div className="msg__assistant-content"><Markdown content={streamingText} /></div>}
          </div>}
        </div>
      )}
    </div>
  )
}
