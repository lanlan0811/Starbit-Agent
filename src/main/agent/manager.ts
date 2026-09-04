import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentPart, ErrorEvent, PermissionMode, SessionEvent, UsageEvent } from '@core/events'
import { BUILTIN_MODELS, getModel, type ModelConfig, type ThinkingLevel } from '@core/models'
import { nanoid } from '@core/nanoid'
import { PermissionService } from '@core/permission'
import { BUILTIN_DANGEROUS_RULES } from '@core/permission/dangerous-rules'
import type { RuleScope } from '@core/permission/rules'
import { AgentLoop, type PermissionConfirmationRequest, type PermissionResponse } from './loop'
import { OpenAiCompatibleProvider } from '../provider/openai-provider'
import { PromptAssembler } from '../prompts/assembler'
import { redact } from '../security/redact'
import { SettingsService } from '../security/settings'
import { getUsageSummary, listAudit, listWhitelist, recordUsage, upsertWhitelist, writeAudit } from '../session/database'
import { SessionManager } from '../session/manager'
import { createBuiltinToolRegistry, type ShellSettings } from '../tools/builtin'
import { SkillManager } from '../skills/manager'
import { HookRunner, type HookDefinition } from '../hooks/runner'

export interface PermissionPromptDto {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  semanticLabel: string
  subject: string
  command?: string
  impact: string
  mode: PermissionMode
}

interface PendingPermission {
  sessionId: string
  resolve: (response: PermissionResponse) => void
}

export type AgentEventSink =
  | { type: 'session/event'; sessionId: string; event: SessionEvent }
  | { type: 'agent/status'; sessionId: string; status: 'idle' | 'running' | 'waiting-confirmation' }
  | { type: 'permission/request'; sessionId: string; request: PermissionPromptDto }

/** 管理每个会话的 AgentLoop、取消和权限确认生命周期。 */
export class AgentManager {
  private readonly active = new Map<string, AgentLoop>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly provider = new OpenAiCompatibleProvider()

  constructor(
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly push: (event: AgentEventSink) => void
  ) {}

  async send(sessionId: string, content: string, attachments: ContentPart[] = [], thinkingLevel: ThinkingLevel = 'max'): Promise<void> {
    if (this.active.has(sessionId)) throw new Error('当前会话已有任务正在运行')
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在: ${sessionId}`)
    this.push({ type: 'agent/status', sessionId, status: 'running' })
    let loop: AgentLoop | null = null
    try {
      const model = this.resolveModel(session.model)
      const apiKey = this.settings.getSecret(`model:${model.id}:apiKey`) || process.env.STARBIT_API_KEY || ''
      if (!apiKey) throw new Error(`模型 ${model.id} 尚未配置 API Key，请在设置中完成配置。`)
      const registry = createBuiltinToolRegistry({ shell: this.resolveShell() })
      const skills = new SkillManager({ workspacePath: session.workspacePath })
      await skills.scan()
      skills.registerTools(registry)
      const permissions = new PermissionService(BUILTIN_DANGEROUS_RULES)
      permissions.setMode(session.mode)
      permissions.setRules(listWhitelist())
      const [projectRules, memorySection, directSkillContext] = await Promise.all([
        readOptional(join(session.workspacePath, 'AGENTS.md')),
        readOptional(join(session.workspacePath, 'memory.md')),
        skills.directContext(content)
      ])
      const assembled = await new PromptAssembler({
        workspacePath: session.workspacePath,
        os: `${process.platform} ${process.arch}`,
        shell: this.resolveShell().executable,
        model: model.id,
        thinkingLevel,
        mode: session.mode,
        tools: registry.listForMode(session.mode),
        projectRules,
        memorySection,
        skillsIndex: skills.index()
      }).assemble()
      const hooks = new HookRunner()
      hooks.setHooks(this.settings.getJson<HookDefinition[]>('hooks', []))
      const promptHook = await hooks.run('UserPromptSubmit', {
        sessionId,
        workspacePath: session.workspacePath,
        payload: { content, attachments }
      })
      if (!promptHook.allowed) throw new Error(promptHook.messages.join('\n') || 'UserPromptSubmit Hook 已阻断消息')
      const hookedPrompt = asPromptPayload(promptHook.payload, content, attachments)
      loop = new AgentLoop({
        sessionId,
        workspacePath: session.workspacePath,
        model,
        apiKey,
        thinkingLevel,
        systemPrompt: assembled.systemPrompt,
        skillsIndex: assembled.skillsIndex,
        registry,
        permissions,
        provider: this.provider,
        initialEvents: this.sessions.replay(sessionId),
        onEvent: (event) => this.recordEvent(event),
        confirm: (request) => this.requestPermission(sessionId, request),
        onRuleChange: upsertWhitelist,
        beforeToolUse: async (call) => {
          const result = await hooks.run('PreToolUse', { sessionId, workspacePath: session.workspacePath, payload: call })
          return { allowed: result.allowed, call: result.payload as typeof call, reason: result.messages.join('\n') }
        },
        afterToolUse: async (call, result) => {
          await hooks.run('PostToolUse', {
            sessionId,
            workspacePath: session.workspacePath,
            payload: { call, result: result instanceof Error ? { error: result.message } : result }
          })
        }
      })
      this.active.set(sessionId, loop)
      await hooks.run('SessionStart', { sessionId, workspacePath: session.workspacePath, payload: { resumed: this.sessions.replay(sessionId).length > 0 } })
      await loop.run(
        hookedPrompt.content,
        hookedPrompt.attachments,
        directSkillContext ? `<loaded-skill>\n${directSkillContext}\n</loaded-skill>` : ''
      )
      await hooks.run('SessionEnd', { sessionId, workspacePath: session.workspacePath, payload: { status: 'completed' } })
    } catch (error) {
      if (!loop) this.recordEvent(this.errorEvent(sessionId, error))
      throw error
    } finally {
      this.active.delete(sessionId)
      this.push({ type: 'agent/status', sessionId, status: 'idle' })
    }
  }

  cancel(sessionId: string): void {
    this.active.get(sessionId)?.cancel()
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) {
        pending.resolve({ outcome: 'deny', scope: 'once', reason: '任务已取消' })
        this.pendingPermissions.delete(requestId)
      }
    }
  }

  respondPermission(requestId: string, outcome: 'allow' | 'deny', scope: RuleScope, reason?: string): boolean {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    pending.resolve({ outcome, scope, reason })
    this.pendingPermissions.delete(requestId)
    this.push({ type: 'agent/status', sessionId: pending.sessionId, status: 'running' })
    return true
  }

  usageSummary(sessionId?: string): ReturnType<typeof getUsageSummary> {
    return getUsageSummary(sessionId)
  }

  audit(limit?: number, sessionId?: string): ReturnType<typeof listAudit> {
    return listAudit(limit, sessionId)
  }

  setModelApiKey(modelId: string, apiKey: string): void {
    if (!getModel(modelId)) throw new Error(`未知模型: ${modelId}`)
    this.settings.setSecret(`model:${modelId}:apiKey`, apiKey.trim())
    writeAudit('model-api-key-updated', JSON.stringify({ modelId, configured: Boolean(apiKey.trim()) }))
  }

  isModelConfigured(modelId: string): boolean {
    return this.settings.hasSecret(`model:${modelId}:apiKey`) || Boolean(process.env.STARBIT_API_KEY)
  }

  getShell(): ShellSettings {
    return this.resolveShell()
  }

  setShell(shell: ShellSettings): void {
    if (!shell.executable.trim() || !Array.isArray(shell.args)) throw new Error('Shell 配置无效')
    this.settings.setJson('shell', { executable: shell.executable.trim(), args: shell.args })
    writeAudit('shell-settings-updated', JSON.stringify(redact(shell)))
  }

  async listSkills(workspacePath: string): Promise<ReturnType<SkillManager['list']>> {
    const manager = new SkillManager({ workspacePath })
    await manager.scan()
    return manager.list()
  }

  async testModel(modelId: string): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const model = this.resolveModel(modelId)
    const apiKey = this.settings.getSecret(`model:${model.id}:apiKey`) || process.env.STARBIT_API_KEY || ''
    if (!apiKey) return { ok: false, latencyMs: 0, message: '尚未配置 API Key' }
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      for await (const event of this.provider.stream({
        model,
        apiKey,
        messages: [{ role: 'user', content: '仅回复 OK' }],
        thinkingLevel: 'low',
        maxOutputTokens: 16,
        signal: controller.signal
      })) {
        if (event.type === 'done') break
      }
      return { ok: true, latencyMs: Date.now() - startedAt, message: '连接成功' }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timeout)
    }
  }

  private resolveModel(id: string): ModelConfig {
    const fallback = getModel(id) ?? getModel('qwen3.8-max') ?? BUILTIN_MODELS[0]
    const override = this.settings.getJson<Partial<ModelConfig>>(`model:${fallback.id}:override`, {})
    return { ...fallback, ...override, id: fallback.id, thinking: override.thinking ?? fallback.thinking }
  }

  private resolveShell(): ShellSettings {
    const configured = this.settings.getJson<Partial<ShellSettings>>('shell', {})
    if (configured.executable && Array.isArray(configured.args)) return { executable: configured.executable, args: configured.args }
    return process.platform === 'win32'
      ? { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] }
      : { executable: process.env.SHELL || '/bin/sh', args: ['-lc'] }
  }

  private requestPermission(
    sessionId: string,
    request: PermissionConfirmationRequest
  ): Promise<PermissionResponse> {
    const requestId = nanoid('permission')
    const dto: PermissionPromptDto = {
      requestId,
      sessionId,
      toolCallId: request.call.id,
      toolName: request.call.name,
      semanticLabel: request.semanticLabel,
      subject: request.subject,
      command: request.rawCommand,
      impact: request.impact,
      mode: request.mode
    }
    this.push({ type: 'agent/status', sessionId, status: 'waiting-confirmation' })
    this.push({ type: 'permission/request', sessionId, request: dto })
    return new Promise((resolve) => this.pendingPermissions.set(requestId, { sessionId, resolve }))
  }

  private recordEvent(event: SessionEvent): void {
    this.sessions.append(event.sessionId, event)
    if (event.type === 'usage') this.recordUsageEvent(event)
    if (event.type === 'permissionDecision') writeAudit('permission-decision', JSON.stringify(redact(event)), event.sessionId)
    this.push({ type: 'session/event', sessionId: event.sessionId, event })
  }

  private recordUsageEvent(event: UsageEvent): void {
    recordUsage({
      id: event.id,
      sessionId: event.sessionId,
      model: event.model,
      promptTokens: event.promptTokens,
      cachedTokens: event.cachedTokens,
      outputTokens: event.outputTokens,
      hitRate: event.hitRate,
      missCategory: event.missCategory,
      isSubagent: event.isSubagent
    })
  }

  private errorEvent(sessionId: string, error: unknown): ErrorEvent {
    return {
      id: nanoid('event'),
      sessionId,
      createdAt: Date.now(),
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      retriable: true
    }
  }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function asPromptPayload(value: unknown, fallbackContent: string, fallbackAttachments: ContentPart[]): { content: string; attachments: ContentPart[] } {
  if (!value || typeof value !== 'object') return { content: fallbackContent, attachments: fallbackAttachments }
  const record = value as Record<string, unknown>
  return {
    content: typeof record.content === 'string' ? record.content : fallbackContent,
    attachments: Array.isArray(record.attachments) ? (record.attachments as ContentPart[]) : fallbackAttachments
  }
}
