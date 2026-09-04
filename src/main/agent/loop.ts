import type { AssistantMessageEvent, ContentPart, SessionEvent, ToolCall, ToolResultEvent, UsageEvent } from '@core/events'
import type { ModelConfig, ThinkingLevel } from '@core/models'
import { nanoid } from '@core/nanoid'
import { PermissionService, type PermissionRequest } from '@core/permission'
import type { RuleScope } from '@core/permission/rules'
import type { PermissionRule } from '@core/permission/rules'
import { ToolRegistry } from '@core/tools/registry'
import type { ToolResult } from '@core/tools/types'
import type { JsonValue } from '@core/types'
import { PrefixFingerprintTracker } from '../provider/canonical'
import type { NormalizedUsage, ProviderMessage, ProviderRequest, ProviderStreamEvent, ProviderTool } from '../provider/types'

const MAX_TOOL_ROUNDS = 16

export interface ProviderClient {
  stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent>
}

export interface PermissionResponse {
  outcome: 'allow' | 'deny'
  scope: RuleScope
  reason?: string
}

export type PermissionConfirmationRequest = PermissionRequest & { call: ToolCall; impact: string }

export interface AgentLoopOptions {
  sessionId: string
  workspacePath: string
  model: ModelConfig
  apiKey: string
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  skillsIndex: string
  registry: ToolRegistry
  permissions: PermissionService
  provider: ProviderClient
  initialEvents?: SessionEvent[]
  onEvent: (event: SessionEvent) => void
  confirm: (request: PermissionConfirmationRequest) => Promise<PermissionResponse>
  onRuleChange?: (rule: PermissionRule) => void
  beforeToolUse?: (call: ToolCall) => Promise<{ allowed: boolean; call?: ToolCall; reason?: string }>
  afterToolUse?: (call: ToolCall, result: ToolResult | Error) => Promise<void>
  grantedRoots?: string[]
  maxToolRounds?: number
}

interface PendingCall {
  id: string
  name: string
  arguments: string
}

type SessionEventInput = {
  [Type in SessionEvent['type']]: Omit<Extract<SessionEvent, { type: Type }>, 'id' | 'sessionId' | 'createdAt'>
}[SessionEvent['type']]

export class AgentLoop {
  private readonly messages: ProviderMessage[]
  private readonly prefixTracker = new PrefixFingerprintTracker()
  private controller: AbortController | null = null
  private running = false

  constructor(private readonly options: AgentLoopOptions) {
    this.messages = rebuildMessages(options.initialEvents ?? [], options.systemPrompt)
  }

  get isRunning(): boolean {
    return this.running
  }

  cancel(): void {
    this.controller?.abort()
  }

  async run(content: string, attachments: ContentPart[] = [], appendedContext = ''): Promise<void> {
    if (this.running) throw new Error('当前会话的 Agent 正在运行')
    this.running = true
    this.controller = new AbortController()
    try {
      this.emit({
        type: 'userMessage',
        content,
        attachments: attachments.length ? attachments : undefined
      })
      const userContent: ProviderMessage['content'] = attachments.length
        ? [{ kind: 'text', text: content }, ...attachments]
        : content
      this.messages.push({ role: 'user', content: userContent })
      if (appendedContext.trim()) this.messages.push({ role: 'system', content: appendedContext })
      await this.completeRounds()
    } catch (error) {
      if (this.controller.signal.aborted) {
        this.emit({ type: 'error', message: '任务已取消。', retriable: true })
      } else {
        this.emit({ type: 'error', message: errorMessage(error), stack: error instanceof Error ? error.stack : undefined, retriable: true })
        throw error
      }
    } finally {
      this.controller = null
      this.running = false
    }
  }

  private async completeRounds(): Promise<void> {
    const limit = this.options.maxToolRounds ?? MAX_TOOL_ROUNDS
    for (let round = 0; round < limit; round += 1) {
      const tools = toProviderTools(this.options.registry.listForMode(this.options.permissions.getMode()))
      const prefix = this.prefixTracker.compare({
        system: this.options.systemPrompt,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        })) as JsonValue,
        skills: this.options.skillsIndex
      })
      if (prefix.changed) {
        this.emit({ type: 'error', message: `系统前缀发生变化：${prefix.changedSections.join(', ')}`, retriable: false })
      }
      const response = await this.collectResponse(tools, prefix.fingerprint)
      const calls = parseCalls(response.calls)
      this.emit<AssistantMessageEvent>({
        type: 'assistantMessage',
        text: response.text,
        thinking: response.thinking || undefined,
        toolCalls: calls
      })
      if (response.thinking) this.emit({ type: 'thinking', content: response.thinking })
      this.messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.input) }))
      })
      if (calls.length === 0) return
      await this.executeCalls(calls)
    }
    throw new Error(`工具调用轮次超过上限（${limit}）`)
  }

  private async collectResponse(tools: ProviderTool[], fingerprint: string): Promise<{ text: string; thinking: string; calls: PendingCall[] }> {
    let text = ''
    let thinking = ''
    const calls = new Map<number, PendingCall>()
    for await (const event of this.options.provider.stream({
      model: this.options.model,
      apiKey: this.options.apiKey,
      messages: this.messages,
      tools,
      thinkingLevel: this.options.thinkingLevel,
      promptCacheKey: this.options.sessionId,
      signal: this.controller?.signal
    })) {
      if (event.type === 'text-delta') text += event.delta
      else if (event.type === 'reasoning-delta') thinking += event.delta
      else if (event.type === 'tool-call-delta') {
        const current = calls.get(event.index) ?? { id: event.id ?? nanoid('tool'), name: event.name ?? '', arguments: '' }
        if (event.id) current.id = event.id
        if (event.name) current.name = event.name
        current.arguments += event.argumentsDelta
        calls.set(event.index, current)
      } else if (event.type === 'usage') this.emitUsage(event.usage, fingerprint)
    }
    return { text, thinking, calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value) }
  }

  private async executeCalls(calls: ToolCall[]): Promise<void> {
    const prepared: Array<{ call: ToolCall; allowed: boolean; request?: PermissionRequest }> = []
    for (const call of calls) {
      if (this.options.beforeToolUse) {
        const hook = await this.options.beforeToolUse(call)
        if (!hook.allowed) {
          this.recordToolFailure(call, hook.reason || 'PreToolUse Hook 已阻断工具调用', 'rejected')
          prepared.push({ call, allowed: false })
          continue
        }
        if (hook.call) Object.assign(call, hook.call)
      }
      const tool = this.options.registry.get(call.name)
      if (!tool) {
        this.recordToolFailure(call, `未注册工具: ${call.name}`)
        prepared.push({ call, allowed: false })
        continue
      }
      const input = asRecord(call.input)
      const subject = permissionSubject(call.name, input)
      const request: PermissionRequest = {
        tool,
        semanticLabel: tool.semanticLabel,
        subject,
        mode: this.options.permissions.getMode(),
        rawCommand: tool.kind === 'shell' ? subject : undefined,
        createsDirectory: tool.semanticLabel === 'Mkdir'
      }
      const decision = this.options.permissions.decide(request)
      let allowed = decision.verdict === 'allow'
      let reason = decision.dangerousRule?.description
      if (decision.verdict === 'ask') {
        const response = await this.options.confirm({ ...request, call, impact: describeImpact(request) })
        allowed = response.outcome === 'allow'
        reason = response.reason
        const rule = this.options.permissions.recordDecision(request, response.outcome, response.scope)
        if (rule) this.options.onRuleChange?.(rule)
      }
      this.emit({
        type: 'permissionDecision',
        toolCallId: call.id,
        mode: request.mode,
        decision: allowed ? 'allow' : 'deny',
        matchedRule: decision.matchedRule?.id ?? decision.dangerousRule?.id,
        reason
      })
      if (!allowed) this.recordToolFailure(call, reason ? `权限拒绝：${reason}` : '权限拒绝', 'rejected')
      prepared.push({ call, allowed, request })
    }

    const readonly = prepared.filter((item) => item.allowed && item.request?.tool.readOnly)
    const mutating = prepared.filter((item) => item.allowed && !item.request?.tool.readOnly)
    await Promise.all(readonly.map((item) => this.executeOne(item.call)))
    for (const item of mutating) await this.executeOne(item.call)
  }

  private async executeOne(call: ToolCall): Promise<void> {
    this.emitTool(call.id, 'running', '')
    try {
      const result = await this.options.registry.execute(call.name, call.input, {
        workspacePath: this.options.workspacePath,
        sessionId: this.options.sessionId,
        toolCallId: call.id,
        mode: this.options.permissions.getMode(),
        grantedRoots: this.options.grantedRoots,
        signal: this.controller?.signal
      })
      const content = result.untrusted ? wrapUntrusted(result.content) : result.content
      this.emitTool(call.id, 'success', content, result)
      this.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
      await this.options.afterToolUse?.(call, result)
    } catch (error) {
      this.recordToolFailure(call, errorMessage(error))
      await this.options.afterToolUse?.(call, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private recordToolFailure(call: ToolCall, message: string, status: 'failed' | 'rejected' = 'failed'): void {
    this.emitTool(call.id, status, message)
    this.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: message })
  }

  private emitTool(toolCallId: string, status: ToolResultEvent['result']['status'], content: string, result?: ToolResult): void {
    this.emit<ToolResultEvent>({
      type: 'toolResult',
      result: {
        toolCallId,
        status,
        content,
        truncated: result?.truncated ?? false,
        outputFile: result?.outputFile,
        outputBytes: Buffer.byteLength(content, 'utf8')
      }
    })
  }

  private emitUsage(usage: NormalizedUsage, requestFingerprint: string): void {
    this.emit<UsageEvent>({
      type: 'usage',
      model: this.options.model.id,
      promptTokens: usage.promptTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      hitRate: usage.hitRate,
      requestFingerprint
    })
  }

  private emit<T extends SessionEvent = SessionEvent>(event: SessionEventInput): T {
    const complete = { ...event, id: nanoid('event'), sessionId: this.options.sessionId, createdAt: Date.now() } as T
    this.options.onEvent(complete)
    return complete
  }
}

function parseCalls(pending: PendingCall[]): ToolCall[] {
  return pending.map((call) => {
    if (!call.name) throw new Error('模型返回了缺少名称的工具调用')
    let input: unknown = {}
    try {
      input = call.arguments.trim() ? JSON.parse(call.arguments) : {}
    } catch {
      throw new Error(`工具 ${call.name} 参数不是有效 JSON: ${call.arguments}`)
    }
    return { id: call.id, name: call.name, input: input as ToolCall['input'], raw: call.arguments }
  })
}

function toProviderTools(definitions: ReturnType<ToolRegistry['listForMode']>): ProviderTool[] {
  return definitions.map((tool) => ({ name: tool.fullName, description: tool.description, parameters: tool.inputJsonSchema, strict: true }))
}

function rebuildMessages(events: SessionEvent[], systemPrompt: string): ProviderMessage[] {
  const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }]
  const callNames = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'userMessage') {
      messages.push({ role: 'user', content: event.attachments?.length ? [{ kind: 'text', text: event.content }, ...event.attachments] : event.content })
    } else if (event.type === 'assistantMessage') {
      for (const call of event.toolCalls) callNames.set(call.id, call.name)
      messages.push({ role: 'assistant', content: event.text, toolCalls: event.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.input) })) })
    } else if (event.type === 'toolResult' && event.result.status !== 'running') {
      messages.push({ role: 'tool', toolCallId: event.result.toolCallId, name: callNames.get(event.result.toolCallId), content: event.result.content })
    } else if (event.type === 'compaction') {
      messages.push({ role: 'system', content: `会话历史摘要：\n${event.summary}` })
    }
  }
  return messages
}

function describeImpact(request: PermissionRequest): string {
  if (request.rawCommand) return `实际执行命令：${request.rawCommand}\n工作目录：工具会话工作区`
  return `${request.semanticLabel} 将作用于：${request.subject}`
}

function wrapUntrusted(content: string): string {
  return `<untrusted-data>\n${content}\n</untrusted-data>`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function permissionSubject(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command
  if (typeof input.path === 'string') return input.path
  if (Array.isArray(input.paths) && input.paths.every((item) => typeof item === 'string')) return input.paths.join(', ')
  if (typeof input.url === 'string') return input.url
  if (typeof input.selector === 'string') return input.selector
  return toolName
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
