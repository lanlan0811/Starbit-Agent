import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import type { ThinkingEvent } from '@core/events'
import './thinking.css'

export function ThinkingBlock({ event }: { event: ThinkingEvent }): JSX.Element {
  const [open, setOpen] = useState(false)
  const duration = event.durationMs != null ? event.durationMs / 1000 : null
  const label = duration != null ? `思考过程 (${duration.toFixed(1)}s)` : '思考过程'

  return (
    <div className="thinking">
      <button className="thinking__header" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} />
        <span className="thinking__label">{label}</span>
      </button>
      {open && <div className="thinking__body">{event.content}</div>}
    </div>
  )
}
