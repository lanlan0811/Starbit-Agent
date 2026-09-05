import { Check, X, Loader2, AlertTriangle } from 'lucide-react'
import type { ToolCall, ToolResultEvent, ToolStatus } from '@core/events'
import { useT } from '../../../i18n'
import './tool.css'

const STATUS_META: Record<ToolStatus, { color: string; icon: JSX.Element }> = {
  running: { color: 'var(--color-primary)', icon: <Loader2 size={16} className="tool__spin" /> },
  success: { color: 'var(--color-success)', icon: <Check size={16} /> },
  failed: { color: 'var(--color-danger)', icon: <X size={16} /> },
  'pending-confirmation': { color: 'var(--color-warning)', icon: <AlertTriangle size={16} /> },
  rejected: { color: 'var(--color-text-secondary)', icon: <X size={16} /> }
}

export function ToolMessage({ event, toolCalls = {} }: { event: ToolResultEvent; toolCalls?: Record<string, ToolCall> }): JSX.Element {
  const { t } = useT()
  const r = event.result
  const meta = STATUS_META[r.status]
  const call = toolCalls[r.toolCallId]
  const subject = call ? summarizeInput(call.name, call.input) : ''

  return (
    <div className="tool" style={{ borderLeftColor: meta.color }}>
      <div className="tool__row">
        <span className="tool__status" style={{ color: meta.color }}>
          {meta.icon}
        </span>
        <span className="tool__name">{call?.name ?? t('chat.tool')}</span>
        {subject && <span className="tool__path" title={subject}>{subject}</span>}
        {r.outputFile && <span className="tool__path">{t('chat.outputSaved')}</span>}
        {r.truncated && <span className="tool__truncated">{t('chat.truncated')}</span>}
      </div>
      {r.diff && <DiffView diff={r.diff} />}
      {r.content && (
        <details className="tool__details">
          <summary>{t('chat.viewDetails')}</summary>
          <pre className="tool__content">{r.content}</pre>
        </details>
      )}
    </div>
  )
}

/** unified diff 渲染：按行着色，折叠展示避免打断阅读。 */
function DiffView({ diff }: { diff: string }): JSX.Element {
  const { t } = useT()
  const lines = diff.split('\n')
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
  return (
    <details className="tool__diff">
      <summary>
        <span className="tool__diff-added">+{added}</span> <span className="tool__diff-removed">−{removed}</span> {t('chat.viewDiff')}
      </summary>
      <pre className="tool__diff-code">
        {lines.map((line, index) => (
          <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'is-add' : line.startsWith('-') && !line.startsWith('---') ? 'is-remove' : line.startsWith('@@') ? 'is-hunk' : ''}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </details>
  )
}

/** 输入摘要：文件类工具显示目标路径，Bash 显示命令，其余显示首个字符串参数。 */
function summarizeInput(name: string, input: unknown): string {
  const record = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (typeof record.path === 'string') return record.path
  if (typeof record.command === 'string') return record.command
  if (typeof record.url === 'string') return record.url
  if (typeof record.query === 'string') return record.query
  if (typeof record.pattern === 'string') return record.pattern
  if (name === 'Task' && typeof record.description === 'string') return record.description
  return ''
}
