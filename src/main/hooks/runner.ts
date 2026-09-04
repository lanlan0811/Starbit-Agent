import { spawn } from 'node:child_process'

export type HookName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'SessionStart'
  | 'SessionEnd'

export interface HookDefinition {
  id: string
  event: HookName
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  enabled?: boolean
}

export interface HookInput {
  sessionId: string
  workspacePath: string
  payload: unknown
}

export interface HookResult {
  allowed: boolean
  payload: unknown
  messages: string[]
}

interface HookOutput {
  decision?: 'allow' | 'deny'
  payload?: unknown
  message?: string
}

/** 执行用户配置的 hooks；JSON 经 stdin/stdout 传递，避免命令拼接。 */
export class HookRunner {
  private hooks: HookDefinition[] = []

  setHooks(hooks: HookDefinition[]): void {
    this.hooks = hooks.filter((hook) => hook.enabled !== false).map((hook) => ({ ...hook, args: [...(hook.args ?? [])] }))
  }

  list(event?: HookName): HookDefinition[] {
    return this.hooks.filter((hook) => !event || hook.event === event).map((hook) => ({ ...hook, args: [...(hook.args ?? [])] }))
  }

  async run(event: HookName, input: HookInput, signal?: AbortSignal): Promise<HookResult> {
    let payload = input.payload
    const messages: string[] = []
    for (const hook of this.hooks.filter((item) => item.event === event)) {
      const output = await executeHook(hook, { ...input, payload }, signal)
      if (output.message) messages.push(output.message)
      if (output.payload !== undefined) payload = output.payload
      if (output.decision === 'deny') return { allowed: false, payload, messages }
    }
    return { allowed: true, payload, messages }
  }
}

async function executeHook(hook: HookDefinition, input: HookInput, signal?: AbortSignal): Promise<HookOutput> {
  const timeoutMs = Math.max(100, Math.min(hook.timeoutMs ?? 30000, 600000))
  return new Promise<HookOutput>((resolve, reject) => {
    const child = spawn(hook.command, hook.args ?? [], {
      cwd: hook.cwd || input.workspacePath,
      env: { ...process.env, ...hook.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdin.end(JSON.stringify(input))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Hook ${hook.id} 执行超时（${timeoutMs}ms）`))
    }, timeoutMs)
    const abort = (): void => { child.kill() }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) return reject(new Error(`Hook ${hook.id} 退出码 ${code}${errorText ? `：${errorText}` : ''}`))
      const text = Buffer.concat(stdout).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text) as HookOutput)
      } catch {
        resolve({ message: text })
      }
    })
  })
}
