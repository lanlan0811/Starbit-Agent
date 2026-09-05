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
import type { NormalizedUsage, PrefixComparison, ProviderMessage, ProviderRequest, ProviderStreamEvent, ProviderTool } from '../provider/types'
import { ContextManager, type CompactionLevel, type CompactionReason, type ContextStatus } from './context'
import { assemblePromptTemplate } from '../prompts/assembler'

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
  prefixTracker?: PrefixFingerprintTracker
  isSubagent?: boolean
  onDelta?: (delta: { text?: string; thinking?: string }) => void
  onContextStatus?: (status: ContextStatus) => void
  onCacheDiagnostic?: (diagnostic: CacheDiagnostic) => void
  confirmCompaction?: (request: CompactionConfirmationRequest) => Promise<boolean>
  beforeCompact?: (request: CompactionConfirmationRequest) => Promise<{ allowed: boolean; reason?: string }>
  compactionModel?: ModelConfig
  compactionApiKey?: string
}

export interface CompactionConfirmationRequest extends Omit<ContextStatus, 'level'> {
  level: CompactionLevel
  contextLevel: ContextStatus['level']
  reason: CompactionReason
}

export interface CacheDiagnostic {
  hitRate: number
  missCategory?: 'avoidable' | 'ttl' | 'compaction'
  changedSections: string[]
  requestFingerprint: string
  /** 记录时间（诊断视图排序用） */
  createdAt: number
}

interface PendingCall {
  id: string
  name: string
  arguments: string
}

interface ExecutedCall {
  status: 'success' | 'failed' | 'rejected'
  content: string
  result?: ToolResult
}

type SessionEventInput = {
  [Type in SessionEvent['type']]: Omit<Extract<SessionEvent, { type: Type }>, 'id' | 'sessionId' | 'createdAt'>
}[SessionEvent['type']]

export class AgentLoop {
  private messages: ProviderMessage[]
  private readonly prefixTracker: PrefixFingerprintTracker
  private readonly context: ContextManager
  private controller: AbortController | null = null
  private running = false
  private eventCount: number
  private lastRequestAt = 0
  private compactionMissPending = false
  private compactionDecisionMessageCount = -1

  constructor(private readonly options: AgentLoopOptions) {
    this.messages = rebuildMessages(options.initialEvents ?? [], options.systemPrompt)
    this.prefixTracker = options.prefixTracker ?? new PrefixFingerprintTracker()
    this.context = new ContextManager(options.model)
    this.eventCount = options.initialEvents?.length ?? 0
    this.reportContext()
  }

  get isRunning(): boolean {
    return this.running
  }

  cancel(): void {
    this.controller?.abort()
  }

  async run(content: string, attachments: ContentPart[] = [], appendedContext = '', fileRefs: string[] = []): Promise<void> {
    if (this.running) throw new Error('当前会话的 Agent 正在运行')
    this.running = true
    this.controller = new AbortController()
    try {
      this.emit({
        type: 'userMessage',
        content,
        attachments: attachments.length ? attachments : undefined,
        fileRefs: fileRefs.length ? fileRefs : undefined
      })
      const referenced = withFileRefs(content, fileRefs)
      const userContent: ProviderMessage['content'] = attachments.length
        ? [{ kind: 'text', text: referenced }, ...attachments]
        : referenced
      this.messages.push({ role: 'user', content: userContent })
      if (appendedContext.trim()) this.messages.push({ role: 'system', content: appendedContext })
      if (content.trim() === '/compact' && attachments.length === 0) {
        await this.compact('full', 'manual')
        return
      }
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
      this.controller?.signal.throwIfAborted()
      await this.maybeCompact()
      this.controller?.signal.throwIfAborted()
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
      const response = await this.collectResponse(tools, prefix)
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
        reasoningContent: response.thinking || undefined,
        toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.input) }))
      })
      this.reportContext()
      if (calls.length === 0) return
      await this.executeCalls(calls)
    }
    throw new Error(`工具调用轮次超过上限（${limit}）`)
  }

  private async collectResponse(tools: ProviderTool[], prefix: PrefixComparison): Promise<{ text: string; thinking: string; calls: PendingCall[] }> {
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
      if (event.type === 'text-delta') {
        text += event.delta
        this.options.onDelta?.({ text: event.delta })
      } else if (event.type === 'reasoning-delta') {
        thinking += event.delta
        this.options.onDelta?.({ thinking: event.delta })
      }
      else if (event.type === 'tool-call-delta') {
        const current = calls.get(event.index) ?? { id: event.id ?? nanoid('tool'), name: event.name ?? '', arguments: '' }
        if (event.id) current.id = event.id
        if (event.name) current.name = event.name
        current.arguments += event.argumentsDelta
        calls.set(event.index, current)
      } else if (event.type === 'usage') this.emitUsage(event.usage, prefix)
    }
    return { text, thinking, calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value) }
  }

  private async executeCalls(calls: ToolCall[]): Promise<void> {
    const prepared: Array<{ call: ToolCall; allowed: boolean; request?: PermissionRequest }> = []
    const outcomes = new Map<string, ExecutedCall>()
    for (const original of calls) {
      const call = structuredClone(original)
      if (this.options.beforeToolUse) {
        const hook = await this.options.beforeToolUse(call)
        if (!hook.allowed) {
          outcomes.set(call.id, { status: 'rejected', content: hook.reason || 'PreToolUse Hook 已阻断工具调用' })
          prepared.push({ call, allowed: false })
          continue
        }
        if (hook.call) Object.assign(call, hook.call, { id: original.id })
      }
      const tool = this.options.registry.get(call.name)
      if (!tool) {
        outcomes.set(call.id, { status: 'failed', content: `未注册工具: ${call.name}` })
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
      if (!allowed) outcomes.set(call.id, { status: 'rejected', content: reason ? `权限拒绝：${reason}` : '权限拒绝' })
      prepared.push({ call, allowed, request })
    }

    const readonly = prepared.filter((item) => item.allowed && item.request?.tool.readOnly)
    const mutating = prepared.filter((item) => item.allowed && !item.request?.tool.readOnly)
    await Promise.all(readonly.map(async (item) => outcomes.set(item.call.id, await this.executeOne(item.call))))
    for (const item of mutating) outcomes.set(item.call.id, await this.executeOne(item.call))
    // 只读执行可并行，但事件和模型历史始终按原始调用顺序追加。
    for (const call of calls) {
      const outcome = outcomes.get(call.id)!
      this.emitTool(call.id, outcome.status, outcome.content, outcome.result)
      this.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: outcome.content })
    }
    this.reportContext()
  }

  private async executeOne(call: ToolCall): Promise<ExecutedCall> {
    this.emitTool(call.id, 'running', '')
    let outcome: ExecutedCall
    let hookResult: ToolResult | Error
    try {
      this.controller?.signal.throwIfAborted()
      const result = await this.options.registry.execute(call.name, call.input, {
        workspacePath: this.options.workspacePath,
        sessionId: this.options.sessionId,
        toolCallId: call.id,
        mode: this.options.permissions.getMode(),
        grantedRoots: this.options.grantedRoots,
        signal: this.controller?.signal
      })
      const content = result.untrusted ? wrapUntrusted(result.content) : result.content
      outcome = { status: 'success', content, result }
      hookResult = result
    } catch (error) {
      outcome = { status: 'failed', content: errorMessage(error) }
      hookResult = error instanceof Error ? error : new Error(String(error))
    }
    try {
      await this.options.afterToolUse?.(call, hookResult)
    } catch (error) {
      this.emit({ type: 'error', message: `PostToolUse Hook 失败：${errorMessage(error)}`, retriable: true })
    }
    return outcome
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
        diff: result?.diff || undefined,
        outputBytes: Buffer.byteLength(content, 'utf8')
      }
    })
  }

  private emitUsage(usage: NormalizedUsage, prefix: PrefixComparison, forcedCategory?: UsageEvent['missCategory']): void {
    const now = Date.now()
    const missCategory = forcedCategory ?? classifyMiss(usage, {
      prefixChanged: prefix.changed,
      compaction: this.compactionMissPending,
      elapsedMs: this.lastRequestAt ? now - this.lastRequestAt : 0
    })
    this.lastRequestAt = now
    this.compactionMissPending = false
    this.emit<UsageEvent>({
      type: 'usage',
      model: this.options.model.id,
      promptTokens: usage.promptTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      hitRate: usage.hitRate,
      requestFingerprint: prefix.fingerprint,
      missCategory,
      isSubagent: this.options.isSubagent
    })
    this.options.onCacheDiagnostic?.({
      hitRate: usage.hitRate,
      missCategory,
      changedSections: prefix.changedSections,
      requestFingerprint: prefix.fingerprint,
      createdAt: now
    })
  }

  private emit<T extends SessionEvent = SessionEvent>(event: SessionEventInput): T {
    const complete = { ...event, id: nanoid('event'), sessionId: this.options.sessionId, createdAt: Date.now() } as T
    this.options.onEvent(complete)
    this.eventCount += 1
    return complete
  }

  private async maybeCompact(): Promise<void> {
    let status = this.reportContext()
    if (status.level === 'normal' || this.compactionDecisionMessageCount === this.messages.length) return
    this.compactionDecisionMessageCount = this.messages.length
    const micro = this.context.microcompact(this.messages)
    if (micro.changed > 0) {
      const applied = await this.requestCompaction('micro', 'automatic', status)
      if (applied) {
        this.messages = micro.messages
        this.emit({
          type: 'compaction',
          level: 'micro',
          reason: 'automatic',
          summary: `已清理 ${micro.changed} 条早期工具结果，保留结果预览、大小与校验摘要。`,
          preservedRange: [0, Math.max(0, this.eventCount - 1)],
          estimatedTokens: status.estimatedTokens,
          contextSnapshot: structuredClone(this.messages.slice(1))
        })
        this.compactionMissPending = true
        status = this.reportContext()
      }
    }
    if (status.level === 'critical') {
      await this.compact('full', 'automatic', status)
      if (this.reportContext().level === 'critical') {
        throw new Error('上下文仍达到硬顶，已暂停模型请求；请压缩历史或新建会话。')
      }
    }
  }

  private async compact(level: CompactionLevel, reason: CompactionReason, status = this.reportContext()): Promise<void> {
    if (level === 'micro') return
    const applied = await this.requestCompaction(level, reason, status)
    if (!applied) return
    const preview = this.context.compactWithSummary(this.messages, '正在生成摘要…')
    const summary = await this.summarize(this.messages.slice(1, preview.preservedStart))
    const compacted = this.context.compactWithSummary(this.messages, summary)
    this.messages = compacted.messages
    const end = Math.max(0, this.eventCount - 1)
    const start = Math.max(0, end - this.context.preservedRecentMessages)
    this.emit({
      type: 'compaction',
      level: 'full',
      reason,
      summary,
      preservedRange: [start, end],
      estimatedTokens: status.estimatedTokens,
      contextSnapshot: structuredClone(this.messages.slice(1))
    })
    this.compactionMissPending = true
    this.reportContext()
  }

  private async requestCompaction(level: CompactionLevel, reason: CompactionReason, status: ContextStatus): Promise<boolean> {
    const request: CompactionConfirmationRequest = { ...status, contextLevel: status.level, level, reason }
    const hook = await this.options.beforeCompact?.(request)
    if (hook && !hook.allowed) return false
    return this.options.confirmCompaction ? this.options.confirmCompaction(request) : true
  }

  private async summarize(messages: ProviderMessage[]): Promise<string> {
    if (messages.length === 0) return '没有需要归纳的早期历史。'
    const summaryMessages: ProviderMessage[] = [
      {
        role: 'system',
        content: await assemblePromptTemplate('compaction.md', {})
      },
      { role: 'user', content: serializeForSummary(messages) }
    ]
    let summary = ''
    const tools: ProviderTool[] = []
    const prefix = new PrefixFingerprintTracker().compare({ system: summaryMessages[0].content as string, tools: [], skills: [] })
    for await (const event of this.options.provider.stream({
      model: this.options.compactionModel ?? this.options.model,
      apiKey: this.options.compactionApiKey ?? this.options.apiKey,
      messages: summaryMessages,
      tools,
      thinkingLevel: 'low',
      sampling: { temperature: 0 },
      maxOutputTokens: Math.min(4_096, this.options.model.maxOutputTokens),
      promptCacheKey: `${this.options.sessionId}:compact`,
      signal: this.controller?.signal
    })) {
      if (event.type === 'text-delta') summary += event.delta
      else if (event.type === 'usage') this.emitUsage(event.usage, prefix, 'compaction')
    }
    if (!summary.trim()) throw new Error('压缩模型没有返回摘要')
    return summary.trim()
  }

  private reportContext(): ContextStatus {
    const status = this.context.inspect(this.messages)
    this.options.onContextStatus?.(status)
    return status
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

export function rebuildMessages(events: SessionEvent[], systemPrompt: string): ProviderMessage[] {
  const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }]
  let lastFullCompactionIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'compaction' && (event.contextSnapshot || event.level !== 'micro')) {
      lastFullCompactionIndex = index
      break
    }
  }
  if (lastFullCompactionIndex >= 0) {
    const compaction = events[lastFullCompactionIndex]
    if (compaction.type === 'compaction') {
      if (compaction.contextSnapshot) {
        messages.push(...structuredClone(compaction.contextSnapshot))
        appendEventMessages(messages, events.slice(lastFullCompactionIndex + 1))
        return messages
      }
      messages.push({ role: 'system', content: `会话历史结构化摘要：\n${compaction.summary}` })
      const [start, end] = compaction.preservedRange
      appendEventMessages(messages, events.slice(Math.max(0, start), Math.min(lastFullCompactionIndex, end + 1)))
      appendEventMessages(messages, events.slice(lastFullCompactionIndex + 1))
      return messages
    }
  }
  appendEventMessages(messages, events)
  return messages
}

function appendEventMessages(messages: ProviderMessage[], events: SessionEvent[]): void {
  const callNames = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'userMessage') {
      const referenced = withFileRefs(event.content, event.fileRefs ?? [])
      messages.push({ role: 'user', content: event.attachments?.length ? [{ kind: 'text', text: referenced }, ...event.attachments] : referenced })
    } else if (event.type === 'assistantMessage') {
      for (const call of event.toolCalls) callNames.set(call.id, call.name)
      messages.push({ role: 'assistant', content: event.text, reasoningContent: event.thinking, toolCalls: event.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.input) })) })
    } else if (event.type === 'toolResult' && event.result.status !== 'running') {
      messages.push({ role: 'tool', toolCallId: event.result.toolCallId, name: callNames.get(event.result.toolCallId), content: event.result.content })
    }
  }
}

function describeImpact(request: PermissionRequest): string {
  if (request.rawCommand) return `实际执行命令：${request.rawCommand}\n工作目录：工具会话工作区`
  return `${request.semanticLabel} 将作用于：${request.subject}`
}

function wrapUntrusted(content: string): string {
  return `<untrusted-data>\n${content}\n</untrusted-data>`
}

/** 将 @文件 引用追加为用户消息尾部文本，保证回放与首传的 provider 消息一致。 */
function withFileRefs(content: string, fileRefs: string[]): string {
  if (!fileRefs.length) return content
  return `${content}\n\n[引用文件]\n${fileRefs.map((path) => `- ${path}`).join('\n')}`
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

function classifyMiss(
  usage: NormalizedUsage,
  context: { prefixChanged: boolean; compaction: boolean; elapsedMs: number }
): UsageEvent['missCategory'] {
  if (usage.promptTokens <= 0 || usage.hitRate >= 0.95) return undefined
  if (context.compaction) return 'compaction'
  if (context.prefixChanged) return 'avoidable'
  if (context.elapsedMs >= 5 * 60_000) return 'ttl'
  return context.elapsedMs > 0 ? 'avoidable' : undefined
}

function serializeForSummary(messages: ProviderMessage[]): string {
  return messages.map((message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => part.kind === 'text'
        ? part.text ?? ''
        : `[${part.kind} attachment · ${part.mimeType ?? 'unknown'}]`).join('\n')
    const calls = message.toolCalls?.length
      ? `\n工具调用：${message.toolCalls.map((call) => `${call.name}(${call.arguments})`).join('; ')}`
      : ''
    return `## ${message.role}\n${content}${calls}`
  }).join('\n\n')
}
