import { Archive, X } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'

export function CompactionDialog(): JSX.Element | null {
  const { t } = useT()
  const request = useAppStore((state) => state.compactionPrompt)
  const setRequest = useAppStore((state) => state.setCompactionPrompt)
  const [busy, setBusy] = useState(false)
  if (!request) return null

  const respond = async (accepted: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.starbit.agent.respondCompaction(request.requestId, accepted)
      setRequest(null)
    } finally {
      setBusy(false)
    }
  }

  const percentage = Math.round(request.ratio * 100)
  return <div className="permission-backdrop" role="presentation">
    <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="compaction-title">
      <header className="permission-dialog__header">
        <span className="permission-dialog__icon"><Archive size={20} /></span>
        <div><h2 id="compaction-title">{t('compaction.title')}</h2><p>{request.level === 'micro' ? t('compaction.micro') : t('compaction.full')}</p></div>
        <button className="permission-dialog__close" title={t('compaction.cancelTitle')} disabled={busy} onClick={() => void respond(false)}><X size={18} /></button>
      </header>
      <div className="permission-dialog__body">
        <p className="compaction-warning">{t('compaction.warning', { percent: percentage, tokens: request.estimatedTokens.toLocaleString(), window: request.contextWindow.toLocaleString() })}</p>
        <p className="compaction-warning">{t('compaction.warning2')}</p>
      </div>
      <footer className="permission-dialog__actions">
        <button className="button button--ghost" disabled={busy} onClick={() => void respond(false)}>{t('common.cancel')}</button>
        <button className="button button--primary" disabled={busy} onClick={() => void respond(true)}>{t('compaction.continue')}</button>
      </footer>
    </section>
  </div>
}
