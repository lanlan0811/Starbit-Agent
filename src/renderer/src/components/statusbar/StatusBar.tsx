import { useAppStore } from '../../stores/app'
import { PermissionMode } from '@core/events'
import './statusbar.css'

const MODE_LABEL: Record<PermissionMode, string> = {
  plan: '计划',
  acceptEdits: '自动编辑',
  fullAccess: '完全访问'
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
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const currentModel = useAppStore((s) => s.currentModel)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const agentStatus = useAppStore((s) => s.agentStatus)
  const contextStatus = useAppStore((s) => s.contextStatus)
  const cacheDiagnostic = useAppStore((s) => s.cacheDiagnostic)

  const statusText = agentStatus === 'running' ? '运行中' : agentStatus === 'waiting-confirmation' ? '等待确认' : '空闲'
  const modeColor =
    mode === 'plan' ? 'var(--color-primary)' : mode === 'acceptEdits' ? 'var(--color-success)' : 'var(--color-warning)'
  const contextPercentage = Math.round((contextStatus?.ratio ?? 0) * 100)
  const cachePercentage = cacheDiagnostic ? cacheDiagnostic.hitRate * 100 : null
  const cacheState = cachePercentage === null ? 'neutral' : cachePercentage >= 95 ? 'green' : 'yellow'

  return (
    <footer className={`statusbar ${agentStatus === 'waiting-confirmation' ? 'statusbar--waiting' : ''}`}>
      <div className="statusbar__left">
        <button
          className="statusbar__mode"
          style={{ color: modeColor, borderColor: modeColor }}
          title="切换权限模式"
          onClick={() => setMode(mode === 'plan' ? 'acceptEdits' : mode === 'acceptEdits' ? 'fullAccess' : 'plan')}
        >
          {MODE_LABEL[mode]} <span className="statusbar__chev">▼</span>
        </button>

        <span className="statusbar__model" title="当前模型">
          {currentModel || '未选择模型'}
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

        <button className="statusbar__cache" title={cacheDiagnostic ? `miss 分类：${cacheDiagnostic.missCategory ?? '无'}；前缀变化：${cacheDiagnostic.changedSections.join(', ') || '无'}` : '尚无缓存用量数据'} onClick={() => useAppStore.getState().setActiveSection('usage')}>
          <span className={`statusbar__dot statusbar__dot--${cacheState}`} />
          命中率 {cachePercentage === null ? '—' : `${cachePercentage.toFixed(1)}%`}
        </button>

        <label className="statusbar__workspace" title="工作区路径">
          {workspacePath || '未打开工作区'}
        </label>

        <span className={`statusbar__agent statusbar__agent--${agentStatus}`}>{statusText}</span>
      </div>
    </footer>
  )
}
