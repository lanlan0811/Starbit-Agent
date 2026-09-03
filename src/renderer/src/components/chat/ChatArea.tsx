import { PanelLeft, PanelRight } from 'lucide-react'
import { ChatFlow } from './ChatFlow'
import { InputArea } from '../input/InputArea'
import './chat.css'

export function ChatArea(): JSX.Element {
  return (
    <main className="chat-area">
      <header className="chat-header">
        <button className="chat-header__btn" title="折叠侧栏">
          <PanelLeft size={16} />
        </button>
        <div className="chat-header__title">衔星 · Starbit 工作台</div>
        <button className="chat-header__btn" title="展开右侧面板">
          <PanelRight size={16} />
        </button>
      </header>
      <ChatFlow />
      <InputArea />
    </main>
  )
}
