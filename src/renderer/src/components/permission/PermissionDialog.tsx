import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import type { RuleScope } from '@core/permission/rules'
import { useAppStore } from '../../stores/app'
import './permission.css'

export function PermissionDialog(): JSX.Element | null {
  const request = useAppStore((state) => state.permissionPrompt)
  const setRequest = useAppStore((state) => state.setPermissionPrompt)
  const [busy, setBusy] = useState(false)

  if (!request) return null

  const respond = async (outcome: 'allow' | 'deny', scope: RuleScope): Promise<void> => {
    setBusy(true)
    setRequest(null)
    try {
      await window.starbit.permission.respond(request.requestId, outcome, scope)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="permission-backdrop" role="presentation">
      <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <header className="permission-dialog__header">
          <span className="permission-dialog__icon"><AlertTriangle size={20} /></span>
          <div>
            <h2 id="permission-title">需要确认操作</h2>
            <p>{request.toolName} · {request.mode}</p>
          </div>
          <button className="permission-dialog__close" title="拒绝" disabled={busy} onClick={() => void respond('deny', 'once')}>
            <X size={18} />
          </button>
        </header>
        <div className="permission-dialog__body">
          <label>目标</label>
          <code>{request.subject}</code>
          <label>实际影响</label>
          <pre>{request.impact}</pre>
          {request.command && <><label>完整命令</label><pre>{request.command}</pre></>}
        </div>
        <footer className="permission-dialog__actions">
          <button className="button button--ghost" disabled={busy} onClick={() => void respond('deny', 'once')}>拒绝</button>
          <button className="button button--secondary" disabled={busy} onClick={() => void respond('allow', 'session')}>
            <ShieldCheck size={15} /> 本会话允许
          </button>
          <button className="button button--primary" disabled={busy} onClick={() => void respond('allow', 'once')}>允许一次</button>
        </footer>
      </section>
    </div>
  )
}
