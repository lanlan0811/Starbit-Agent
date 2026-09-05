import { useAppStore } from '../../stores/app'
import { PermissionMode } from '@core/events'
import { useT } from '../../i18n'
import './statusbar.css'

const MODE_KEY: Record<PermissionMode, string> = {
  plan: 'mode.plan',
  acceptEdits: 'mode.acceptEdits',
  fullAccess: 'mode.fullAccess'
}

/** 思考强度三档 segmented control */
function ThinkingControl(): JSX.Element {
  const levels = ['low', 'high', 'max'] as const
  const level = useAppStore((state) => state.thinkingLevel)
  const setLevel = useAppStore((state) => state.setThinkingLevel)
  return (
    <div className="statusbar__thinking">
      {levels.map((l) => (
        <button key={l} className={`statusbar__thinking-btn ${level === l ? 'is-active' : ''}`} onClick={() => setLevel(l)}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function StatusBar(): JSX.Element {
  const { t } = useT()
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const currentModel = useAppStore((s) => s.currentModel)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const agentStatus = useAppStore((s) => s.agentStatus)
  const contextStatus = useAppStore((s) => s.contextStatus)
  const cacheDiagnostic = useAppStore((s) => s.cacheDiagnostic)

  const statusText = agentStatus === 'running' ? t('status.running') : agentStatus === 'waiting-confirmation' ? t('status.waiting') : t('status.idle')
  const modeColor =
    mode === 'plan' ? 'var(--color-primary)' : mode === 'acceptEdits' ? 'var(--color-success)' : 'var(--color-warning)'
  const contextPercentage = Math.round((contextStatus?.ratio ?? 0) * 100)
  const cachePercentage = cacheDiagnostic ? cacheDiagnostic.hitRate * 100 : null
  const cacheState = cachePercentage === null ? 'neutral' : cachePercentage >= 95 ? 'green' : 'yellow'
  const cacheTooltip = cacheDiagnostic
    ? t('status.cacheDetail', {
        category: cacheDiagnostic.missCategory ? t(`usage.miss${cacheDiagnostic.missCategory === 'avoidable' ? 'Avoidable' : cacheDiagnostic.missCategory === 'ttl' ? 'Ttl' : 'Compaction'}`) : t('status.missNone'),
        sections: cacheDiagnostic.changedSections.join(', ') || t('status.missNone')
      })
    : t('status.cacheNoData')

  return (
    <footer className={`statusbar ${agentStatus === 'waiting-confirmation' ? 'statusbar--waiting' : ''}`}>
      <div className="statusbar__left">
        <button
          className="statusbar__mode"
          style={{ color: modeColor, borderColor: modeColor }}
          title={t('status.switchMode')}
          onClick={() => setMode(mode === 'plan' ? 'acceptEdits' : mode === 'acceptEdits' ? 'fullAccess' : 'plan')}
        >
          {t(MODE_KEY[mode])} <span className="statusbar__chev">▼</span>
        </button>

        <span className="statusbar__model" title={t('status.currentModel')}>
          {currentModel || t('status.noModel')}
        </span>

        <ThinkingControl />
      </div>

      <div className="statusbar__right">
        <div className="statusbar__ctx">
          <div className="statusbar__ctx-bar">
            <div className="statusbar__ctx-fill" style={{ width: `${contextPercentage}%` }} />
          </div>
          <span className="statusbar__ctx-text">{contextPercentage}%</span>
        </div>

        <button className="statusbar__cache" title={cacheTooltip} onClick={() => useAppStore.getState().setActiveSection('usage')}>
          <span className={`statusbar__dot statusbar__dot--${cacheState}`} />
          {t('status.hitRate')} {cachePercentage === null ? '—' : `${cachePercentage.toFixed(1)}%`}
        </button>

        <label className="statusbar__workspace" title={t('status.workspace')}>
          {workspacePath || t('status.noWorkspace')}
        </label>

        <span className={`statusbar__agent statusbar__agent--${agentStatus}`}>{statusText}</span>
      </div>
    </footer>
  )
}
