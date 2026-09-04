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

interface NavItem {
  key: string
  label: string
  icon: JSX.Element
  shortcut?: string
  type: 'brand' | 'section' | 'panel'
}

const SECTION_ITEMS: NavItem[] = [
  { key: 'sessions', label: '会话列表', shortcut: '⌘1', icon: <MessageSquare size={20} />, type: 'section' },
  { key: 'files', label: '文件树', shortcut: '⌘2', icon: <FolderTree size={20} />, type: 'section' },
  { key: 'kb', label: '知识库', icon: <BookOpen size={20} />, type: 'section' },
  { key: 'memory', label: '记忆管理', icon: <Sparkles size={20} />, type: 'section' },
  { key: 'mcp', label: 'MCP 服务器', icon: <Plug size={20} />, type: 'section' },
  { key: 'skills', label: '技能库', icon: <Blocks size={20} />, type: 'section' },
  { key: 'usage', label: '用量统计', icon: <BarChart3 size={20} />, type: 'section' },
  { key: 'audit', label: '审计日志', icon: <ShieldCheck size={20} />, type: 'section' },
  { key: 'settings', label: '设置', icon: <Settings size={20} />, type: 'section' }
]

const PANEL_ITEMS: NavItem[] = [
  { key: 'browser', label: '浏览器', icon: <Globe size={20} />, type: 'panel' },
  { key: 'terminal', label: '终端', icon: <SquareTerminal size={20} />, type: 'panel' }
]

export function Sidebar(): JSX.Element {
  const activeSection = useAppStore((state) => state.activeSection)
  const setActiveSection = useAppStore((state) => state.setActiveSection)
  const rightPanel = useAppStore((state) => state.rightPanel)
  const setRightPanel = useAppStore((state) => state.setRightPanel)
  return (
    <nav className="sidebar" aria-label="主导航">
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
            title={item.shortcut ? `${item.label} ${item.shortcut}` : item.label}
            data-tooltip={item.shortcut ? `${item.label} ${item.shortcut}` : item.label}
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
            data-tooltip={item.label}
            title={item.label}
            onClick={() => setRightPanel(rightPanel === item.key ? null : item.key as 'browser' | 'terminal')}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </nav>
  )
}
