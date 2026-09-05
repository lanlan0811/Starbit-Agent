import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import type { RuleScope } from '@core/permission/rules'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import './permission.css'

export function PermissionDialog(): JSX.Element | null {
  const { t } = useT()
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
            <h2 id="permission-title">{t('permission.title')}</h2>
            <p>{request.toolName} · {request.mode}</p>
          </div>
          <button className="permission-dialog__close" title={t('permission.deny')} disabled={busy} onClick={() => void respond('deny', 'once')}>
            <X size={18} />
          </button>
        </header>
        <div className="permission-dialog__body">
          <label>{t('permission.subject')}</label>
          <code>{request.subject}</code>
          <label>{t('permission.impact')}</label>
          <pre>{request.impact}</pre>
          {request.command && <><label>{t('permission.command')}</label><pre>{request.command}</pre></>}
        </div>
        <footer className="permission-dialog__actions">
          <button className="button button--ghost" disabled={busy} onClick={() => void respond('deny', 'once')}>{t('permission.deny')}</button>
          <button className="button button--secondary" disabled={busy} onClick={() => void respond('allow', 'session')}>
            <ShieldCheck size={15} /> {t('permission.allowSession')}
          </button>
          <button className="button button--primary" disabled={busy} onClick={() => void respond('allow', 'once')}>{t('permission.allowOnce')}</button>
        </footer>
      </section>
    </div>
  )
}
