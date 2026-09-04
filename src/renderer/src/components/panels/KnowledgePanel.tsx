import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Database, FilePlus2, Link, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { KnowledgeBaseRecord, KnowledgeDocumentRecord, KnowledgeSearchHit } from '../../../../main/knowledge/types'
import { useAppStore } from '../../stores/app'

export function KnowledgePanel(): JSX.Element {
  const sessionId = useAppStore((state) => state.currentSessionId)
  const [bases, setBases] = useState<KnowledgeBaseRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      setBases([])
      setDocuments([])
      return
    }
    const nextBases = await window.starbit.knowledge.listBases(sessionId)
    setBases(nextBases)
    const nextSelected = nextBases.some((base) => base.id === selectedId) ? selectedId : nextBases[0]?.id ?? ''
    setSelectedId(nextSelected)
    setDocuments(nextSelected ? await window.starbit.knowledge.listDocuments(sessionId, nextSelected) : [])
  }, [sessionId, selectedId])

  useEffect(() => { void load().catch((error) => setMessage(String(error))) }, [load])

  const act = async (operation: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await operation()
      await load()
      setMessage(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!sessionId) return <EmptyText>请先创建或选择工作区会话。</EmptyText>

  const createBase = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim()) return
    await act(async () => {
      const created = await window.starbit.knowledge.createBase(sessionId, name)
      setSelectedId(created.id)
      setName('')
    }, '知识库已创建。')
  }

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setMessage('')
    try {
      setHits(await window.starbit.knowledge.search(sessionId, query, selectedId || undefined))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-stack" aria-busy={busy}>
      <form className="settings-group" onSubmit={(event) => void createBase(event)}>
        <h3><Database size={15} /> 知识库</h3>
        <label htmlFor="knowledge-name">新知识库名称</label>
        <div className="panel-inline">
          <input id="knowledge-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="项目资料" />
          <button className="panel-button panel-button--icon" title="创建知识库" disabled={busy || !name.trim()}><Plus size={15} /></button>
        </div>
        <label htmlFor="knowledge-base">当前知识库</label>
        <select id="knowledge-base" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setHits([]) }}>
          <option value="">请选择</option>
          {bases.map((base) => <option key={base.id} value={base.id}>{base.name}（{base.documentCount}）</option>)}
        </select>
        {selectedId && <button type="button" className="panel-button panel-button--danger" disabled={busy} onClick={() => void act(async () => {
          await window.starbit.knowledge.deleteBase(sessionId, selectedId)
          setSelectedId('')
          setHits([])
        }, '知识库及其索引已删除。')}><Trash2 size={14} /> 删除当前知识库</button>}
      </form>

      {selectedId && <section className="settings-group">
        <h3>导入资料</h3>
        <button className="panel-button" disabled={busy} onClick={() => void act(async () => {
          await window.starbit.knowledge.selectAndImport(sessionId, selectedId)
        }, '文档已导入并完成索引。')}><FilePlus2 size={14} /> 选择文档</button>
        <div className="panel-inline">
          <input aria-label="网页地址" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" />
          <button className="panel-button panel-button--icon" title="导入网页" disabled={busy || !url.trim()} onClick={() => void act(async () => {
            await window.starbit.knowledge.importUrl(sessionId, selectedId, url)
            setUrl('')
          }, '网页已导入并完成索引。')}><Link size={15} /></button>
        </div>
        <button className="panel-button" disabled={busy} onClick={() => void act(async () => {
          await window.starbit.knowledge.rebuild(sessionId, selectedId)
        }, '当前知识库索引已重建。')}><RefreshCw size={14} /> 重建索引</button>
      </section>}

      <div className="document-list">
        {documents.map((document) => <article key={document.id}>
          <div><strong>{document.displayName}</strong><span>{document.sourceType} · {document.chunkCount} 个片段</span></div>
          <button title={`删除 ${document.displayName}`} disabled={busy} onClick={() => void act(async () => {
            await window.starbit.knowledge.deleteDocument(sessionId, document.id)
          }, '文档及其索引已删除。')}><Trash2 size={14} /></button>
        </article>)}
        {selectedId && documents.length === 0 && <EmptyText>当前知识库尚无文档。</EmptyText>}
      </div>

      <form className="settings-group" onSubmit={(event) => void search(event)}>
        <h3>语义检索</h3>
        <div className="panel-inline">
          <input aria-label="知识库检索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入问题或关键词" />
          <button className="panel-button panel-button--icon" title="检索" disabled={busy || !query.trim()}><Search size={15} /></button>
        </div>
      </form>
      <div className="search-results">
        {hits.map((hit) => <article key={hit.id}><strong>{hit.displayName}</strong><span>相关度 {(hit.score * 100).toFixed(1)}%</span><p>{hit.content}</p></article>)}
      </div>
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function EmptyText({ children }: { children: string }): JSX.Element {
  return <p className="panel-empty">{children}</p>
}
