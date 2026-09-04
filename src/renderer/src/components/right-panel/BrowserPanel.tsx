import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Bot, Hand, LoaderCircle, Plus, RotateCw, Shield, X } from 'lucide-react'
import { useAppStore } from '../../stores/app'

type BrowserState = Awaited<ReturnType<typeof window.starbit.browser.getState>>

export function BrowserPanel(): JSX.Element {
  const sessionId = useAppStore((state) => state.currentSessionId)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  const updateBounds = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !sessionId) return
    const rect = viewport.getBoundingClientRect()
    void window.starbit.browser.setBounds(sessionId, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0
    }).catch((reason) => setError(String(reason)))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    let disposed = false
    const load = async (): Promise<void> => {
      try {
        let current = await window.starbit.browser.getState(sessionId)
        if (!current.tabs.length) {
          await window.starbit.browser.createTab(sessionId)
          current = await window.starbit.browser.getState(sessionId)
        }
        if (!disposed) {
          setState(current)
          setAddress(current.tabs.find((tab) => tab.id === current.activeTabId)?.url ?? '')
          queueMicrotask(updateBounds)
        }
      } catch (reason) {
        if (!disposed) setError(String(reason))
      }
    }
    const unsubscribe = window.onStarbitEvent((event) => {
      if (event.type === 'browser/state' && event.state.sessionId === sessionId) {
        setState(event.state)
        const active = event.state.tabs.find((tab) => tab.id === event.state.activeTabId)
        if (active) setAddress(active.url)
      } else if (event.type === 'browser/error' && event.sessionId === sessionId) {
        setError(event.message)
      }
    })
    void load()
    return () => {
      disposed = true
      unsubscribe()
      void window.starbit.browser.hide(sessionId)
    }
  }, [sessionId, updateBounds])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !sessionId) return
    const observer = new ResizeObserver(updateBounds)
    observer.observe(viewport)
    window.addEventListener('resize', updateBounds)
    updateBounds()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [sessionId, updateBounds])

  if (!sessionId) return <p className="right-panel__empty">请先创建或选择工作区会话。</p>

  const active = state?.tabs.find((tab) => tab.id === state.activeTabId)
  const run = (action: () => Promise<unknown>): void => {
    setError('')
    void action().catch((reason) => setError(String(reason)))
  }
  const submitAddress = (event: FormEvent): void => {
    event.preventDefault()
    if (!address.trim()) return
    run(() => window.starbit.browser.navigate(sessionId, address, active?.id))
  }

  return (
    <div className="browser-panel">
      <div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
        {state?.tabs.map((tab) => (
          <div key={tab.id} className={`browser-tab ${tab.id === state.activeTabId ? 'browser-tab--active' : ''}`}>
            <button
              role="tab"
              aria-selected={tab.id === state.activeTabId}
              onClick={() => run(() => window.starbit.browser.activateTab(sessionId, tab.id))}
            >
              {tab.loading && <LoaderCircle className="browser-spin" size={13} />}
              <span>{tab.title || '新标签页'}</span>
            </button>
            <button
              className="browser-tab__close"
              aria-label={`关闭 ${tab.title || '标签页'}`}
              onClick={() => run(() => window.starbit.browser.closeTab(sessionId, tab.id))}
            ><X size={12} /></button>
          </div>
        ))}
        <button className="browser-icon-button" title="新建标签页" onClick={() => run(() => window.starbit.browser.createTab(sessionId))}><Plus size={15} /></button>
      </div>
      <form className="browser-toolbar" onSubmit={submitAddress}>
        <button type="button" title="后退" disabled={!active?.canGoBack} onClick={() => run(() => window.starbit.browser.back(sessionId, active?.id))}><ArrowLeft size={16} /></button>
        <button type="button" title="前进" disabled={!active?.canGoForward} onClick={() => run(() => window.starbit.browser.forward(sessionId, active?.id))}><ArrowRight size={16} /></button>
        <button type="button" title="刷新" onClick={() => run(() => window.starbit.browser.reload(sessionId, active?.id))}><RotateCw size={15} /></button>
        <Shield size={14} aria-label="受保护的浏览会话" />
        <input aria-label="浏览器地址" value={address} placeholder="输入网址或搜索内容" onChange={(event) => setAddress(event.target.value)} />
        <button
          type="button"
          className={state?.controlMode === 'human' ? 'browser-control--human' : ''}
          title={state?.controlMode === 'human' ? '交还 Agent 控制' : '人工接管'}
          onClick={() => run(() => window.starbit.browser.setControlMode(sessionId, state?.controlMode === 'human' ? 'agent' : 'human'))}
        >{state?.controlMode === 'human' ? <Hand size={15} /> : <Bot size={15} />}</button>
      </form>
      <details className="browser-security">
        <summary>浏览安全与会话</summary>
        <label><input type="checkbox" checked={state?.reuseLogin ?? false} onChange={(event) => run(() => window.starbit.browser.setReuseLogin(sessionId, event.target.checked))} /> 显式复用登录态</label>
        <label><input type="checkbox" checked={state?.allowPrivateNetwork ?? false} onChange={(event) => run(() => window.starbit.browser.setAllowPrivateNetwork(sessionId, event.target.checked))} /> 允许访问本机和私有网络</label>
      </details>
      {error && <div className="browser-error" role="alert">{error}<button title="关闭错误" onClick={() => setError('')}><X size={13} /></button></div>}
      <div ref={viewportRef} className="browser-viewport" aria-label="浏览器页面区域">
        {!active?.url && <p>在地址栏输入网址或搜索内容。</p>}
      </div>
    </div>
  )
}
