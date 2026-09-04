import { useEffect } from 'react'
import { useAppStore } from '../stores/app'
import { Sidebar } from '../components/sidebar/Sidebar'
import { ChatArea } from '../components/chat/ChatArea'
import { StatusBar } from '../components/statusbar/StatusBar'
import { BrandMark } from '../components/icons/BrandMark'
import { SecondaryPanel } from '../components/panels/SecondaryPanel'
import { PermissionDialog } from '../components/permission/PermissionDialog'
import './app.css'

export default function App(): JSX.Element {
  const setReady = useAppStore((s) => s.setReady)
  const setAppVersion = useAppStore((s) => s.setAppVersion)
  const setModels = useAppStore((s) => s.setModels)
  const setSessions = useAppStore((s) => s.setSessions)
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId)

  useEffect(() => {
    const init = async (): Promise<void> => {
      const [info, models, sessions] = await Promise.all([
        window.starbit.app.getInfo(),
        window.starbit.models.list(),
        window.starbit.session.list()
      ])
      setAppVersion(info.version)
      setModels(models)
      setSessions(sessions)
      if (sessions.length > 0) {
        const current = sessions[0]
        const events = await window.starbit.session.replay(current.id)
        setCurrentSessionId(current.id, events)
        useAppStore.getState().setWorkspacePath(current.workspacePath)
        useAppStore.getState().setModel(current.model || 'qwen3.8-max')
        useAppStore.getState().setMode(current.mode)
      }
      setReady(true)
    }
    void init()
    const unsubscribe = window.onStarbitEvent((ev) => {
      const state = useAppStore.getState()
      if (ev.type === 'session/event' && ev.sessionId === state.currentSessionId) {
        state.appendEvent(ev.event)
      } else if (ev.type === 'agent/status' && ev.sessionId === state.currentSessionId) {
        state.setAgentStatus(ev.status)
      } else if (ev.type === 'permission/request' && ev.sessionId === state.currentSessionId) {
        state.setPermissionPrompt(ev.request)
      } else if (ev.type === 'session/created') {
        state.setSessions([ev.session, ...state.sessions])
      }
    })
    return unsubscribe
  }, [setReady, setAppVersion, setModels, setSessions, setCurrentSessionId])

  return (
    <div className="starbit-shell">
      <Sidebar />
      <SecondaryPanel />
      <ChatArea />
      <StatusBar />
      <BrandMark className="starbit-shell__badge" />
      <PermissionDialog />
    </div>
  )
}
