import {
  MessageSquare,
  FolderTree,
  BookOpen,
  Sparkles,
  Plug,
  Blocks,
  BarChart3,
  ShieldCheck,
  Settings,
  Globe,
  SquareTerminal
} from 'lucide-react'
import { BrandMark } from '../icons/BrandMark'
import './sidebar.css'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'

interface NavItem {
  key: string
  labelKey: string
  icon: JSX.Element
  shortcut?: string
  type: 'brand' | 'section' | 'panel'
}

const SECTION_ITEMS: NavItem[] = [
  { key: 'sessions', labelKey: 'nav.sessions', shortcut: '⌘1', icon: <MessageSquare size={20} />, type: 'section' },
  { key: 'files', labelKey: 'nav.files', shortcut: '⌘2', icon: <FolderTree size={20} />, type: 'section' },
  { key: 'kb', labelKey: 'nav.kb', icon: <BookOpen size={20} />, type: 'section' },
  { key: 'memory', labelKey: 'nav.memory', icon: <Sparkles size={20} />, type: 'section' },
  { key: 'mcp', labelKey: 'nav.mcp', icon: <Plug size={20} />, type: 'section' },
  { key: 'skills', labelKey: 'nav.skills', icon: <Blocks size={20} />, type: 'section' },
  { key: 'usage', labelKey: 'nav.usage', icon: <BarChart3 size={20} />, type: 'section' },
  { key: 'audit', labelKey: 'nav.audit', icon: <ShieldCheck size={20} />, type: 'section' },
  { key: 'settings', labelKey: 'nav.settings', icon: <Settings size={20} />, type: 'section' }
]

const PANEL_ITEMS: NavItem[] = [
  { key: 'browser', labelKey: 'nav.browser', icon: <Globe size={20} />, type: 'panel' },
  { key: 'terminal', labelKey: 'nav.terminal', icon: <SquareTerminal size={20} />, type: 'panel' }
]

export function Sidebar(): JSX.Element {
  const { t } = useT()
  const activeSection = useAppStore((state) => state.activeSection)
  const setActiveSection = useAppStore((state) => state.setActiveSection)
  const rightPanel = useAppStore((state) => state.rightPanel)
  const setRightPanel = useAppStore((state) => state.setRightPanel)
  const label = (item: NavItem): string => (item.shortcut ? `${t(item.labelKey)} ${item.shortcut}` : t(item.labelKey))
  return (
    <nav className="sidebar" aria-label={t('nav.main')}>
      <div className="sidebar__group">
        <button className="sidebar__item sidebar__item--brand" title="衔星" data-tooltip="衔星">
          <BrandMark size={20} />
        </button>
      </div>

      <div className="sidebar__group">
        {SECTION_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`sidebar__item ${activeSection === item.key ? 'sidebar__item--active' : ''}`}
            title={label(item)}
            data-tooltip={label(item)}
            onClick={() => setActiveSection(item.key)}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <div className="sidebar__spacer" />

      <div className="sidebar__group sidebar__group--bottom">
        {PANEL_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`sidebar__item ${rightPanel === item.key ? 'sidebar__item--active' : ''}`}
            data-tooltip={t(item.labelKey)}
            title={t(item.labelKey)}
            onClick={() => setRightPanel(rightPanel === item.key ? null : item.key as 'browser' | 'terminal')}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </nav>
  )
}
