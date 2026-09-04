import { spawn as spawnProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import type { PtyWorkerEvent, PtyWorkerRequest } from './protocol'

interface NativePty {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
}

interface NativePtyModule {
  spawn(executable: string, args: string[], options: Record<string, unknown>): NativePty
}

if (typeof process.send !== 'function') throw new Error('PTY native worker 必须由 supervisor 启动')
const require = createRequire(import.meta.url)
const terminals = new Map<string, NativePty>()
let requestQueue = Promise.resolve()

process.on('message', (request: PtyWorkerRequest) => {
  requestQueue = requestQueue.then(() => handle(request)).catch((error) => {
    const terminalId = 'terminalId' in request ? request.terminalId : 'all'
    post({ type: 'error', terminalId, message: error instanceof Error ? error.message : String(error) })
  })
})
process.send({ type: 'native-worker-ready' })

async function handle(request: PtyWorkerRequest): Promise<void> {
  if (request.type === 'create') {
    const existing = terminals.get(request.terminalId)
    if (existing) {
      existing.resize(clamp(request.cols, 20, 500), clamp(request.rows, 5, 300))
      post({ type: 'ready', terminalId: request.terminalId, pid: existing.pid })
      return
    }
    const pty = require('node-pty') as NativePtyModule
    const terminal = pty.spawn(request.executable, request.args, {
      name: 'xterm-256color',
      cols: clamp(request.cols, 20, 500),
      rows: clamp(request.rows, 5, 300),
      cwd: request.cwd,
      env: request.env,
      useConpty: process.platform === 'win32' ? true : undefined
    })
    terminals.set(request.terminalId, terminal)
    terminal.onData((data) => post({ type: 'data', terminalId: request.terminalId, data }))
    terminal.onExit(({ exitCode, signal }) => {
      terminals.delete(request.terminalId)
      post({ type: 'exit', terminalId: request.terminalId, exitCode, signal })
    })
    post({ type: 'ready', terminalId: request.terminalId, pid: terminal.pid })
  } else if (request.type === 'write') {
    terminals.get(request.terminalId)?.write(request.data)
  } else if (request.type === 'resize') {
    terminals.get(request.terminalId)?.resize(clamp(request.cols, 20, 500), clamp(request.rows, 5, 300))
  } else if (request.type === 'close') {
    await closeTerminal(request.terminalId)
  } else {
    await Promise.all([...terminals.keys()].map(closeTerminal))
    post({ type: 'closed-all' })
  }
}

async function closeTerminal(terminalId: string): Promise<void> {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  terminals.delete(terminalId)
  const pid = terminal.pid
  try { terminal.kill() } catch { /* 进程可能已经退出 */ }
  if (process.platform === 'win32' && Number.isInteger(pid) && pid > 0) {
    await new Promise<void>((resolve) => {
      const killer = spawnProcess('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => resolve())
      killer.once('close', () => resolve())
    })
  }
}

function post(event: PtyWorkerEvent): void {
  process.send?.(event)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
