import { useEffect, useState } from 'react'
import { Plus, Save, RotateCcw } from 'lucide-react'
import type { ModelConfig } from '@core/models'
import { useAppStore } from '../../stores/app'

export function ModelEditor(): JSX.Element {
  const models = useAppStore((state) => state.models)
  const id = useAppStore((state) => state.currentModel)
  const [draft, setDraft] = useState<ModelConfig | null>(null)
  const [thinking, setThinking] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const model = models.find((item) => item.id === id)
    if (model) { setDraft(structuredClone(model)); setThinking(JSON.stringify(model.thinking, null, 2)) }
  }, [models, id])
  if (!draft) return <></>
  const change = (patch: Partial<ModelConfig>): void => setDraft({ ...draft, ...patch })
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const updated = await window.starbit.models.save({ ...draft, thinking: JSON.parse(thinking) })
      useAppStore.getState().setModels(updated)
      useAppStore.getState().setModel(draft.id)
      setMessage('模型配置已保存，下次发送时生效。')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      const updated = await window.starbit.models.delete(draft.id)
      useAppStore.getState().setModels(updated)
      if (!updated.some((item) => item.id === id)) useAppStore.getState().setModel(updated[0].id)
      setMessage(draft.custom ? '自定义模型已移除。' : '已恢复内置配置。')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  return <section className="settings-group">
    <h3>模型参数</h3>
    <button className="panel-button" onClick={() => {
      setDraft({ ...draft, id: '', name: '', vendor: 'OpenAI Compatible', custom: true, apiKeyRequired: false,
        thinking: { low: { params: {} }, high: { params: {} }, max: { params: {} } } })
      setThinking(JSON.stringify({ low: { params: {} }, high: { params: {} }, max: { params: {} } }, null, 2))
    }}><Plus size={14} /> 新增兼容模型</button>
    <label htmlFor="model-id">模型 ID</label>
    <input id="model-id" value={draft.id} disabled={!draft.custom} onChange={(event) => change({ id: event.target.value })} />
    <label htmlFor="model-name">显示名称</label>
    <input id="model-name" value={draft.name} onChange={(event) => change({ name: event.target.value })} />
    <label htmlFor="model-endpoint">Base URL</label>
    <input id="model-endpoint" value={draft.baseURL} onChange={(event) => change({ baseURL: event.target.value })} />
    <label htmlFor="model-protocol">API 形态</label>
    <select id="model-protocol" value={draft.apiShape} onChange={(event) => change({ apiShape: event.target.value as ModelConfig['apiShape'] })}>
      <option value="chat-completions">Chat Completions</option><option value="responses">Responses</option>
    </select>
    <label className="panel-checkbox"><input type="checkbox" checked={draft.apiKeyRequired !== false} onChange={(event) => change({ apiKeyRequired: event.target.checked })} /> 要求 API Key</label>
    <label htmlFor="model-context">上下文窗口（tokens）</label>
    <input id="model-context" type="number" value={draft.contextWindow} onChange={(event) => change({ contextWindow: Number(event.target.value) })} />
    <label htmlFor="model-output">最大输出（tokens）</label>
    <input id="model-output" type="number" value={draft.maxOutputTokens} onChange={(event) => change({ maxOutputTokens: Number(event.target.value) })} />
    <label htmlFor="model-modalities">模态</label>
    <select id="model-modalities" value={draft.modalities.join(',')} onChange={(event) => change({ modalities: event.target.value.split(',') as ModelConfig['modalities'] })}>
      <option value="text">文本</option><option value="text,image">文本与图片</option><option value="text,image,video">文本、图片与视频</option>
    </select>
    <details><summary>三档思考参数（JSON）</summary><textarea aria-label="三档思考参数" rows={12} value={thinking} onChange={(event) => setThinking(event.target.value)} /></details>
    <div className="panel-actions">
      <button className="panel-button" disabled={busy || !draft.id.trim() || !draft.name.trim()} onClick={() => void save()}><Save size={14} /> 保存模型</button>
      <button className="panel-button" disabled={busy} onClick={() => void remove()}><RotateCcw size={14} /> {draft.custom ? '移除' : '恢复默认'}</button>
    </div>
    {message && <p className="panel-message" role="status">{message}</p>}
  </section>
}
