import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, Search, Save, Trash2, X } from 'lucide-react'
import type { MemoryEntry, MemoryScope, MemorySearchHit } from '../../../../main/memory/types'
import { useAppStore } from '../../stores/app'

export function MemoryPanel(): JSX.Element {
  const sessionId = useAppStore((state) => state.currentSessionId)
  const [scope, setScope] = useState<MemoryScope>('workspace')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MemorySearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!sessionId) return setEntries([])
    setEntries(await window.starbit.memory.list(sessionId))
  }, [sessionId])

  useEffect(() => { void load().catch((error) => setMessage(String(error))) }, [load])

  if (!sessionId) return <p className="panel-empty">请先创建或选择工作区会话。</p>

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!content.trim()) return
    setBusy(true)
    setMessage('')
    try {
      if (editingId) await window.starbit.memory.update(sessionId, editingId, content)
      else await window.starbit.memory.add(sessionId, scope, content)
      setContent('')
      setEditingId(null)
      await load()
      setMessage(editingId ? '记忆已更新。' : '记忆已添加。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      setHits(await window.starbit.memory.search(sessionId, query))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return <div className="panel-stack" aria-busy={busy}>
    <form className="settings-group" onSubmit={(event) => void save(event)}>
      <h3>{editingId ? <Save size={15} /> : <Plus size={15} />} {editingId ? '编辑记忆' : '添加记忆'}</h3>
      {!editingId && <select aria-label="记忆层级" value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)}>
        <option value="workspace">工作区记忆</option>
        <option value="user">用户级记忆</option>
      </select>}
      <textarea aria-label="记忆内容" rows={5} value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录长期有效的偏好、约定或事实" />
      <div className="panel-actions">
        <button className="panel-button" disabled={busy || !content.trim()}>{editingId ? <Save size={14} /> : <Plus size={14} />} {editingId ? '保存' : '添加'}</button>
        {editingId && <button type="button" className="panel-button" onClick={() => { setEditingId(null); setContent('') }}><X size={14} /> 取消</button>}
      </div>
    </form>
    <div className="memory-list">
      {entries.map((entry) => <article key={entry.id}>
        <header><span>{entry.scope === 'workspace' ? '工作区' : '用户'} · {entry.source === 'session' ? '会话摘要' : '手动'}</span><time>{new Date(entry.updatedAt).toLocaleString()}</time></header>
        <p>{entry.content}</p>
        <div className="panel-actions">
          <button className="panel-button" onClick={() => { setEditingId(entry.id); setContent(entry.content) }}><Save size={13} /> 编辑</button>
          <button className="panel-button panel-button--danger" disabled={busy} onClick={() => void (async () => {
            setBusy(true)
            try { await window.starbit.memory.delete(sessionId, entry.id); await load() }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
            finally { setBusy(false) }
          })()}><Trash2 size={13} /> 删除</button>
        </div>
      </article>)}
      {entries.length === 0 && <p className="panel-empty">尚无结构化记忆条目；手写 memory.md 内容仍会自动加载。</p>}
    </div>
    <form className="settings-group" onSubmit={(event) => void search(event)}>
      <h3>检索记忆</h3>
      <div className="panel-inline"><input aria-label="记忆检索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /><button className="panel-button panel-button--icon" title="检索" disabled={busy || !query.trim()}><Search size={15} /></button></div>
    </form>
    <div className="search-results">{hits.map((hit) => <article key={`${hit.path}:${hit.id}`}><strong>{hit.scope === 'workspace' ? '工作区' : '用户'}记忆</strong><span>相关度 {(hit.score * 100).toFixed(1)}%</span><p>{hit.content}</p></article>)}</div>
    {message && <p className="panel-message" role="status">{message}</p>}
  </div>
}
