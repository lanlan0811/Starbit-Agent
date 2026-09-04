import { X } from 'lucide-react'
import { useAppStore } from '../../stores/app'
import { BrowserPanel } from './BrowserPanel'
import { TerminalPanel } from './TerminalPanel'
import './right-panel.css'

export function RightPanel(): JSX.Element | null {
  const panel = useAppStore((state) => state.rightPanel)
  const setPanel = useAppStore((state) => state.setRightPanel)
  if (!panel) return null
  return (
    <aside className="right-panel" aria-label={panel === 'terminal' ? '终端面板' : '浏览器面板'}>
      <header className="right-panel__header">
        <span>{panel === 'terminal' ? '终端' : '浏览器'}</span>
        <button title="关闭面板" onClick={() => setPanel(null)}><X size={16} /></button>
      </header>
      <div className="right-panel__body">
        {panel === 'terminal' ? <TerminalPanel /> : <BrowserPanel />}
      </div>
    </aside>
  )
}
