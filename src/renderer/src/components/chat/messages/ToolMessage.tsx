import { Check, X, Loader2, AlertTriangle } from 'lucide-react'
import type { ToolResultEvent, ToolStatus } from '@core/events'
import './tool.css'

const STATUS_META: Record<ToolStatus, { color: string; icon: JSX.Element }> = {
  running: { color: 'var(--color-primary)', icon: <Loader2 size={16} className="tool__spin" /> },
  success: { color: 'var(--color-success)', icon: <Check size={16} /> },
  failed: { color: 'var(--color-danger)', icon: <X size={16} /> },
  'pending-confirmation': { color: 'var(--color-warning)', icon: <AlertTriangle size={16} /> },
  rejected: { color: 'var(--color-text-secondary)', icon: <X size={16} /> }
}

export function ToolMessage({ event }: { event: ToolResultEvent }): JSX.Element {
  const r = event.result
  const meta = STATUS_META[r.status]

  return (
    <div className="tool" style={{ borderLeftColor: meta.color }}>
      <div className="tool__row">
        <span className="tool__status" style={{ color: meta.color }}>
          {meta.icon}
        </span>
        <span className="tool__name">{r.toolCallId}</span>
        <span className="tool__path">{r.outputFile ? '输出已落盘' : ''}</span>
        {r.truncated && <span className="tool__truncated">已截断</span>}
      </div>
      {r.content && (
        <details className="tool__details">
          <summary>查看详情</summary>
          <pre className="tool__content">{r.content}</pre>
        </details>
      )}
    </div>
  )
}
