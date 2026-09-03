import type { CompactionEvent } from '@core/events'

export function CompactionBanner({ event }: { event: CompactionEvent }): JSX.Element {
  return (
    <div className="compaction">
      <div className="compaction__line" />
      <div className="compaction__label">— 上下文已压缩（保留摘要 + 近期对话）—</div>
      {event.summary && <div className="compaction__summary">{event.summary}</div>}
    </div>
  )
}
