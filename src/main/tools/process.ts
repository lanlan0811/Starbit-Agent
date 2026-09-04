import { spawn, type ChildProcess } from 'node:child_process'

export interface ProcessOptions {
  executable: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

const DEFAULT_PROCESS_OUTPUT_LIMIT = 4 * 1024 * 1024

/** 有界输出、取消和进程树回收；等待退出后再交还临时目录所有权。 */
export function runBoundedProcess(options: ProcessOptions): Promise<string> {
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd, env: options.env, windowsHide: true,
      detached: process.platform !== 'win32'
    })
    const chunks: Buffer[] = []
    const limit = options.maxOutputBytes ?? DEFAULT_PROCESS_OUTPUT_LIMIT
    let bytes = 0
    let failure: Error | undefined
    let cleanup: Promise<void> = Promise.resolve()
    const terminate = (reason: string): void => {
      if (failure) return
      failure = new Error(reason)
      cleanup = terminateProcessTree(child)
    }
    const capture = (chunk: Buffer): void => {
      const remaining = Math.max(0, limit - bytes)
      if (remaining) chunks.push(chunk.subarray(0, remaining))
      bytes += chunk.length
      if (bytes > limit) terminate(`进程输出超过上限（${limit} 字节）`)
    }
    const timer = setTimeout(() => terminate(`进程执行超时（${options.timeoutMs}ms）`), options.timeoutMs)
    const abort = (): void => terminate('进程执行已取消')
    options.signal?.addEventListener('abort', abort, { once: true })
    // 在订阅后再检查，覆盖 spawn 与订阅之间的取消竞态。
    if (options.signal?.aborted) abort()
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('error', (error) => { failure = error })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void cleanup.then(() => {
        const output = Buffer.concat(chunks).toString('utf8')
        if (failure) reject(failure)
        else if (code !== 0) reject(new Error(`进程退出码 ${code}\n${output}`))
        else resolve(output)
      }, reject)
    })
  })
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => { child.kill(); resolve() })
      killer.once('close', () => resolve())
    })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}
