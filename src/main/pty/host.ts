import { utilityProcess, type UtilityProcess } from 'electron'
import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { PtyWorkerEvent, PtyWorkerRequest } from './protocol'

export interface PtyCreateOptions {
  terminalId: string
  executable: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export class PtyHost {
  private dispatcher: UtilityProcess | null = null
  private nativeWorker: ChildProcess | null = null
  private dispatcherReady = false
  private nativeReady = false
  private readonly pendingDispatch: PtyWorkerRequest[] = []
  private readonly pendingNative: PtyWorkerRequest[] = []

  constructor(private readonly onEvent: (event: PtyWorkerEvent) => void) {}

  create(options: PtyCreateOptions): void {
    this.send({
      type: 'create',
      terminalId: options.terminalId,
      executable: options.executable,
      args: options.args ?? [],
      cwd: options.cwd,
      env: { ...safeEnvironment(), ...options.env },
      cols: options.cols ?? 100,
      rows: options.rows ?? 30
    })
  }

  write(terminalId: string, data: string): void {
    this.send({ type: 'write', terminalId, data })
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.send({ type: 'resize', terminalId, cols, rows })
  }

  closeTerminal(terminalId: string): void {
    this.send({ type: 'close', terminalId })
  }

  close(): void {
    if (this.dispatcherReady && this.dispatcher) this.dispatcher.postMessage({ type: 'close-all' } satisfies PtyWorkerRequest)
    killTree(this.dispatcher)
    killTree(this.nativeWorker)
    this.dispatcher = null
    this.nativeWorker = null
    this.dispatcherReady = false
    this.nativeReady = false
    this.pendingDispatch.length = 0
    this.pendingNative.length = 0
  }

  private send(request: PtyWorkerRequest): void {
    const dispatcher = this.ensureDispatcher()
    this.ensureNativeWorker()
    if (this.dispatcherReady) dispatcher.postMessage(request)
    else this.pendingDispatch.push(request)
  }

  private ensureDispatcher(): UtilityProcess {
    if (this.dispatcher) return this.dispatcher
    const dispatcher = utilityProcess.fork(join(__dirname, 'pty-worker.js'), [], { serviceName: 'Starbit PtyHost' })
    dispatcher.on('spawn', () => {
      if (this.dispatcher !== dispatcher) return
      this.dispatcherReady = true
      for (const request of this.pendingDispatch.splice(0)) dispatcher.postMessage(request)
    })
    dispatcher.on('message', (message: { type?: string; request?: PtyWorkerRequest }) => {
      if (message.type !== 'dispatch' || !message.request) return
      this.forwardToNative(message.request)
    })
    dispatcher.on('error', (error) => this.onEvent({ type: 'error', terminalId: 'all', message: String(error) }))
    dispatcher.on('exit', (code) => {
      if (this.dispatcher !== dispatcher) return
      this.dispatcher = null
      this.dispatcherReady = false
      this.onEvent({ type: 'error', terminalId: 'all', message: `PTY 调度进程已退出（${code}）` })
    })
    this.dispatcher = dispatcher
    return dispatcher
  }

  private ensureNativeWorker(): ChildProcess {
    if (this.nativeWorker) return this.nativeWorker
    const workerEnvironment = { ...process.env }
    delete workerEnvironment.NODE_OPTIONS
    delete workerEnvironment.VSCODE_INSPECTOR_OPTIONS
    const worker = fork(join(__dirname, 'pty-native-worker.js'), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...workerEnvironment, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    worker.on('message', (message: PtyWorkerEvent | { type: 'native-worker-ready' }) => {
      if (message.type === 'native-worker-ready') {
        this.nativeReady = true
        for (const request of this.pendingNative.splice(0)) worker.send(request)
      } else if (message.type !== 'closed-all') {
        this.onEvent(message)
      }
    })
    worker.stderr?.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) this.onEvent({ type: 'error', terminalId: 'all', message })
    })
    worker.on('error', (error) => this.onEvent({ type: 'error', terminalId: 'all', message: error.message }))
    worker.on('exit', (code) => {
      if (this.nativeWorker !== worker) return
      this.nativeWorker = null
      this.nativeReady = false
      this.onEvent({ type: 'error', terminalId: 'all', message: `PTY 原生进程已退出（${code ?? 'unknown'}）` })
    })
    this.nativeWorker = worker
    return worker
  }

  private forwardToNative(request: PtyWorkerRequest): void {
    const worker = this.ensureNativeWorker()
    if (this.nativeReady && worker.connected) worker.send(request)
    else this.pendingNative.push(request)
  }
}

function killTree(worker: UtilityProcess | ChildProcess | null): void {
  if (!worker) return
  const pid = worker.pid
  if (process.platform === 'win32' && Number.isInteger(pid) && Number(pid) > 0) {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  worker.kill()
}

function safeEnvironment(): Record<string, string> {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
}
