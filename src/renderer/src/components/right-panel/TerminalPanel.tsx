import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../../stores/app'

export function TerminalPanel(): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const sessionId = useAppStore((state) => state.currentSessionId)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!container.current || !sessionId) return
    const styles = window.getComputedStyle(document.documentElement)
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: styles.getPropertyValue('--color-terminal-bg').trim(),
        foreground: styles.getPropertyValue('--color-terminal-fg').trim(),
        cursor: styles.getPropertyValue('--color-primary').trim(),
        selectionBackground: styles.getPropertyValue('--color-terminal-selection').trim()
      }
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    const serialize = new SerializeAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(search)
    terminal.loadAddon(serialize)
    terminal.open(container.current)
    fit.fit()
    const dataDisposable = terminal.onData((data) => { void window.starbit.terminal.write(sessionId, data) })
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f' && event.type === 'keydown') {
        const query = window.prompt('终端搜索')
        if (query) search.findNext(query)
        return false
      }
      return true
    })
    const unsubscribe = window.onStarbitEvent((event) => {
      if (event.type === 'terminal/data' && event.terminalId === sessionId) terminal.write(event.data)
      else if (event.type === 'terminal/ready' && event.terminalId === sessionId) setReady(true)
      else if (event.type === 'terminal/exit' && event.terminalId === sessionId) terminal.writeln(`\r\n[进程已退出：${event.exitCode}]`)
      else if (event.type === 'terminal/error' && (event.terminalId === sessionId || event.terminalId === 'all')) setError(event.message)
    })
    const observer = new ResizeObserver(() => {
      fit.fit()
      void window.starbit.terminal.resize(sessionId, terminal.cols, terminal.rows)
    })
    observer.observe(container.current)
    void window.starbit.terminal.create(sessionId, terminal.cols, terminal.rows).catch((reason) => setError(String(reason)))
    return () => {
      observer.disconnect()
      unsubscribe()
      dataDisposable.dispose()
      terminal.dispose()
    }
  }, [sessionId])

  if (!sessionId) return <p className="right-panel__empty">请先创建或选择工作区会话。</p>
  return <div className="terminal-wrap" data-ready={ready}>{error && <div className="terminal-error">{error}</div>}<div ref={container} className="terminal-host" /></div>
}
