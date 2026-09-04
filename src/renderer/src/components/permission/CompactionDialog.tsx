import { Archive, X } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../../stores/app'

export function CompactionDialog(): JSX.Element | null {
  const request = useAppStore((state) => state.compactionPrompt)
  const setRequest = useAppStore((state) => state.setCompactionPrompt)
  const [busy, setBusy] = useState(false)
  if (!request) return null

  const respond = async (accepted: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.starbit.agent.respondCompaction(request.requestId, accepted)
      setRequest(null)
    } finally {
      setBusy(false)
    }
  }

  const percentage = Math.round(request.ratio * 100)
  return <div className="permission-backdrop" role="presentation">
    <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="compaction-title">
      <header className="permission-dialog__header">
        <span className="permission-dialog__icon"><Archive size={20} /></span>
        <div><h2 id="compaction-title">上下文即将压缩</h2><p>{request.level === 'micro' ? '清理早期工具结果' : '生成结构化历史摘要'}</p></div>
        <button className="permission-dialog__close" title="取消压缩" disabled={busy} onClick={() => void respond(false)}><X size={18} /></button>
      </header>
      <div className="permission-dialog__body">
        <p className="compaction-warning">当前上下文约占 {percentage}%（{request.estimatedTokens.toLocaleString()} / {request.contextWindow.toLocaleString()} tokens）。压缩会改变请求前缀，并导致下一次缓存失效。</p>
        <p className="compaction-warning">你可以取消；接近模型上限时，后续请求可能因上下文过长而失败。</p>
      </div>
      <footer className="permission-dialog__actions">
        <button className="button button--ghost" disabled={busy} onClick={() => void respond(false)}>取消</button>
        <button className="button button--primary" disabled={busy} onClick={() => void respond(true)}>继续压缩</button>
      </footer>
    </section>
  </div>
}
