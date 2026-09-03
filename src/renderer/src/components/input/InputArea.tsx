import { useRef, useState } from 'react'
import { Paperclip, Image, Film, AtSign, Send, Square } from 'lucide-react'
import { useAppStore } from '../../stores/app'
import './input.css'

export function InputArea(): JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<{ kind: 'image' | 'video'; source: string; name: string }[]>([])
  const running = useAppStore((s) => s.agentStatus === 'running')
  const models = useAppStore((s) => s.models)
  const currentModel = useAppStore((s) => s.currentModel)
  const setModel = useAppStore((s) => s.setModel)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = value.trim().length > 0 || attachments.length > 0

  const handleSend = (): void => {
    if (!canSend) return
    if (running) {
      // TODO: 发送停止请求
      return
    }
    // TODO: 发送消息给 AgentLoop
    setValue('')
    setAttachments([])
  }

  const onFilePick = (kind: 'image' | 'video'): void => {
    fileInputRef.current?.click()
  }

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="input-area">
      {attachments.length > 0 && (
        <div className="input-area__attachments">
          {attachments.map((a, i) => (
            <div key={i} className="input-area__chip">
              {a.name}
              <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="input-area__box">
        <textarea
          ref={textareaRef}
          className="input-area__textarea"
          placeholder="描述你的任务，支持 /命令 和 @文件..."
          value={value}
          onChange={onInput}
          onKeyDown={onKeyDown}
          rows={1}
        />

        <div className="input-area__toolbar">
          <div className="input-area__tools">
            <button className="input-area__tool" title="添加附件">
              <Paperclip size={16} />
            </button>
            <button className="input-area__tool" title="添加图片" onClick={() => onFilePick('image')}>
              <Image size={16} />
            </button>
            <button className="input-area__tool" title="添加视频" onClick={() => onFilePick('video')}>
              <Film size={16} />
            </button>
            <button className="input-area__tool" title="引用文件">
              <AtSign size={16} />
            </button>
          </div>

          <select
            className="input-area__model"
            value={currentModel}
            onChange={(e) => setModel(e.target.value)}
            title="选择模型"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <button
            className={`input-area__send ${!canSend ? 'input-area__send--disabled' : ''}`}
            onClick={handleSend}
            title={running ? '停止 (Esc)' : '发送'}
          >
            {running ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const kind: 'image' | 'video' = file.type.startsWith('image') ? 'image' : 'video'
          const reader = new FileReader()
          reader.onload = () => {
            setAttachments((arr) => [...arr, { kind, source: String(reader.result), name: file.name }])
          }
          reader.readAsDataURL(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
