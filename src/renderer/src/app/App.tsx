import { useEffect } from 'react'
import { useAppStore } from '../stores/app'
import { Sidebar } from '../components/sidebar/Sidebar'
import { ChatArea } from '../components/chat/ChatArea'
import { StatusBar } from '../components/statusbar/StatusBar'
import { BrandMark } from '../components/icons/BrandMark'
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
      // 订阅主进程事件
      window.onStarbitEvent((ev) => {
        if (ev.type === 'session/event') {
          useAppStore.getState().appendEvent(ev.event)
        }
      })
      setReady(true)
    }
    void init()
  }, [setReady, setAppVersion, setModels, setSessions, setCurrentSessionId])

  return (
    <div className="starbit-shell">
      <Sidebar />
      <ChatArea />
      <StatusBar />
      <BrandMark className="starbit-shell__badge" />
    </div>
  )
}
