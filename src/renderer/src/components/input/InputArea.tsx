import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Film, Image, Paperclip, Send, Square, X } from 'lucide-react'
import type { WorkspaceEntryDto } from '../../../../main/workspace/list'
import { useAppStore } from '../../stores/app'
import './input.css'

interface Attachment {
  kind: 'image' | 'video'
  source: string
  name: string
}

const MAX_ATTACHMENTS = 8
/** 弹窗最大候选数量，避免大仓库下拉过长。 */
const SUGGESTION_LIMIT = 8

export function InputArea(): JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [fileRefs, setFileRefs] = useState<string[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceEntryDto[] | null>(null)
  const [mention, setMention] = useState<{ token: string; start: number } | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const running = useAppStore((s) => s.agentStatus !== 'idle')
  const models = useAppStore((s) => s.models)
  const currentModel = useAppStore((s) => s.currentModel)
  const setModel = useAppStore((s) => s.setModel)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const mode = useAppStore((s) => s.mode)
  const thinkingLevel = useAppStore((s) => s.thinkingLevel)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pasteFileRef = useRef<HTMLInputElement>(null)

  const canSend = value.trim().length > 0 || attachments.length > 0

  // 工作区文件清单（用于 @引用弹窗与文件树引用插入），随工作区切换加载
  useEffect(() => {
    let cancelled = false
    if (!workspacePath) {
      setWorkspaceFiles(null)
      return
    }
    void window.starbit.workspace.listFiles(workspacePath).then((entries) => {
      if (!cancelled) setWorkspaceFiles(entries)
    }).catch(() => {
      if (!cancelled) setWorkspaceFiles([])
    })
    return () => { cancelled = true }
  }, [workspacePath])

  // 文件树面板发起的引用插入
  useEffect(() => {
    const pending = useAppStore.getState().consumeFileRef()
    if (!pending) return
    setValue((current) => appendRefToken(current, pending))
    setFileRefs((current) => (current.includes(pending) ? current : [...current, pending]))
    textareaRef.current?.focus()
  }, [])

  const mentionCandidates = useMemo(() => {
    if (!mention || !workspaceFiles) return []
    const query = mention.token.toLowerCase()
    return workspaceFiles
      .filter((entry) => !entry.isDir && (!query || entry.path.toLowerCase().includes(query)))
      .slice(0, SUGGESTION_LIMIT)
  }, [mention, workspaceFiles])

  useEffect(() => { setHighlightIndex(0) }, [mention?.token])

  const refreshMention = (text: string, caret: number): void => {
    const before = text.slice(0, caret)
    const match = /(?:^|[\s(（[])@([^\s@]*)$/.exec(before)
    if (match) {
      const start = caret - match[1].length - 1
      setMention({ token: match[1], start })
    } else setMention(null)
  }

  const handleSend = async (): Promise<void> => {
    if (running) {
      if (currentSessionId) await window.starbit.agent.cancel(currentSessionId)
      return
    }
    if (!canSend) return
    let sessionId = currentSessionId
    let selectedWorkspace = workspacePath
    if (!selectedWorkspace) {
      const selected = await window.starbit.workspace.selectFolder()
      if (!selected) return
      selectedWorkspace = selected.path
      useAppStore.getState().setWorkspacePath(selected.path)
    }
    if (!sessionId) {
      const session = await window.starbit.session.create(selectedWorkspace, { model: currentModel, mode })
      sessionId = session.id
      const state = useAppStore.getState()
      state.setSessions([session, ...state.sessions])
      state.setCurrentSessionId(session.id, [])
    } else {
      await window.starbit.session.update(sessionId, { model: currentModel, mode })
    }
    const message = value.trim()
    const contentParts = attachments.map((attachment) => ({
      kind: attachment.kind,
      source: attachment.source,
      mimeType: attachment.source.slice(5, attachment.source.indexOf(';'))
    }))
    const refs = [...fileRefs]
    setValue('')
    setAttachments([])
    setFileRefs([])
    setMention(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    useAppStore.getState().setAgentStatus('running')
    useAppStore.getState().clearStream()
    try {
      await window.starbit.agent.send(sessionId, message, contentParts, thinkingLevel, refs)
    } catch {
      // 主进程已把可展示错误写入事件流。
    } finally {
      useAppStore.getState().setAgentStatus('idle')
    }
  }

  const onFilePick = (kind: 'image' | 'video'): void => {
    if (fileInputRef.current) fileInputRef.current.accept = `${kind}/*`
    fileInputRef.current?.click()
  }

  const addAttachmentFile = (file: File): void => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return
    const kind: 'image' | 'video' = file.type.startsWith('image') ? 'image' : 'video'
    const reader = new FileReader()
    reader.onload = () => {
      const source = String(reader.result)
      setAttachments((arr) => arr.some((item) => item.source === source) || arr.length >= MAX_ATTACHMENTS
        ? arr
        : [...arr, { kind, source, name: file.name }])
    }
    reader.readAsDataURL(file)
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    files.forEach(addAttachmentFile)
  }

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    e.preventDefault()
    files.forEach(addAttachmentFile)
  }

  const applyMention = (path: string): void => {
    if (!mention) return
    setValue((current) => {
      const before = current.slice(0, mention.start)
      const after = current.slice(mention.start + mention.token.length + 1)
      return `${before}@${path} ${after.trimStart()}`
    })
    setFileRefs((current) => (current.includes(path) ? current : [...current, path]))
    setMention(null)
    textareaRef.current?.focus()
  }

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value)
    refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (mention && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((index) => (index + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        void applyMention(mentionCandidates[highlightIndex].path)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    } else if (e.key === 'Escape' && running) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="input-area">
      {fileRefs.length > 0 && (
        <div className="input-area__attachments">
          {fileRefs.map((ref) => (
            <div key={ref} className="input-area__chip input-area__chip--ref" title={`引用文件 ${ref}`}>
              <AtSign size={11} />
              <span>{ref}</span>
              <button onClick={() => setFileRefs((arr) => arr.filter((item) => item !== ref))}><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="input-area__attachments">
          {attachments.map((a, i) => (
            <div key={i} className="input-area__chip">
              {a.name}
              <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}><X size={11} /></button>
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
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => { if (e.dataTransfer.files.length) e.preventDefault() }}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          rows={1}
        />

        {mention && mentionCandidates.length > 0 && (
          <ul className="input-area__mention" role="listbox" aria-label="引用文件候选">
            {mentionCandidates.map((candidate, index) => (
              <li key={candidate.path} role="option" aria-selected={index === highlightIndex} className={index === highlightIndex ? 'is-active' : ''}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); void applyMention(candidate.path) }}
                  onMouseEnter={() => setHighlightIndex(index)}
                >
                  <span className="input-area__mention-name">{candidate.name}</span>
                  <span className="input-area__mention-path">{candidate.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="input-area__toolbar">
          <div className="input-area__tools">
            <button className="input-area__tool" title="添加附件" onClick={() => pasteFileRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <button className="input-area__tool" title="添加图片" onClick={() => onFilePick('image')}>
              <Image size={16} />
            </button>
            <button className="input-area__tool" title="添加视频" onClick={() => onFilePick('video')}>
              <Film size={16} />
            </button>
            <button
              className="input-area__tool"
              title="引用文件（输入 @ 触发）"
              onClick={() => {
                textareaRef.current?.focus()
                const current = value
                const next = `${current}${current && !current.endsWith(' ') ? ' ' : ''}@`
                setValue(next)
                refreshMention(next, next.length)
              }}
            >
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
            onClick={() => void handleSend()}
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
          if (file) addAttachmentFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={pasteFileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) addAttachmentFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** 在草稿末尾追加 @引用（文件树“引用”按钮入口）。 */
function appendRefToken(current: string, path: string): string {
  return `${current}${current && !current.endsWith('\n') && !current.endsWith(' ') ? ' ' : ''}@${path} `
}
