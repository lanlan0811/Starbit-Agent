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
import { McpManager } from '../mcp/manager'
import type { McpServerConfig, McpServerState } from '../mcp/types'
import type { BrowserAutomation } from '../browser/types'
import { registerBrowserTools } from '../browser/tools'
import { KnowledgeStore } from '../knowledge/store'
import { registerKnowledgeTools } from '../knowledge/tools'
import type { EmbeddingConfig, EmbeddingMode } from '../knowledge/embeddings'
import type { KnowledgeBaseRecord, KnowledgeDocumentRecord, KnowledgeSearchHit } from '../knowledge/types'
import { MemoryStore } from '../memory/store'
import { registerMemoryTools } from '../memory/tools'
import type { MemoryEntry, MemoryScope, MemorySearchHit } from '../memory/types'

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

export interface KnowledgeSettings {
  mode: EmbeddingMode
  baseUrl: string
  model: string
  dimensions: number
  apiKeyConfigured: boolean
}

interface StoredKnowledgeSettings {
  mode: EmbeddingMode
  baseUrl: string
  model: string
  dimensions: number
}

/** 管理每个会话的 AgentLoop、取消和权限确认生命周期。 */
export class AgentManager {
  private readonly active = new Map<string, AgentLoop>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly provider = new OpenAiCompatibleProvider()
  private readonly mcp = new McpManager()
  private readonly knowledgeStores = new Map<string, Promise<KnowledgeStore>>()
  private readonly memoryStores = new Map<string, MemoryStore>()

  constructor(
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly push: (event: AgentEventSink) => void,
    private readonly browser?: BrowserAutomation
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
      if (this.browser) registerBrowserTools(registry, this.browser)
      const [knowledge, memory] = await Promise.all([
        this.getKnowledgeStore(session.workspacePath),
        Promise.resolve(this.getMemoryStore(session.workspacePath))
      ])
      registerKnowledgeTools(registry, knowledge)
      registerMemoryTools(registry, memory)
      const mcpConfigs = this.materializeMcpConfigs(this.settings.getJson<McpServerConfig[]>('mcpServers', []))
      await this.mcp.synchronize(mcpConfigs)
      this.mcp.registerTools(registry)
      const skills = new SkillManager({ workspacePath: session.workspacePath })
      await skills.scan()
      skills.registerTools(registry)
      const permissions = new PermissionService(BUILTIN_DANGEROUS_RULES)
      permissions.setMode(session.mode)
      permissions.setRules(listWhitelist())
      const [memoryContext, directSkillContext] = await Promise.all([
        memory.loadContext(),
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
        projectRules: memoryContext.projectRules,
        memorySection: formatMemorySection(memoryContext.userMemory, memoryContext.workspaceMemory),
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
      await memory.saveSessionSummary(sessionId, summarizeSession(this.sessions.replay(sessionId)))
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

  getTerminalShell(): ShellSettings {
    const configured = this.settings.getJson<Partial<ShellSettings>>('terminalShell', {})
    if (configured.executable && Array.isArray(configured.args)) return { executable: configured.executable, args: configured.args }
    const shell = this.resolveShell()
    const executable = shell.executable.toLowerCase()
    const commandFlags = executable.includes('powershell') || executable.includes('pwsh')
      ? new Set(['-command', '-noninteractive'])
      : executable.endsWith('cmd.exe') || executable === 'cmd'
        ? new Set(['/c'])
        : new Set(['-c', '-lc'])
    return { executable: shell.executable, args: shell.args.filter((arg) => !commandFlags.has(arg.toLowerCase())) }
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

  async listMcpServers(): Promise<McpServerState[]> {
    const configs = this.settings.getJson<McpServerConfig[]>('mcpServers', [])
    await this.mcp.synchronize(this.materializeMcpConfigs(configs))
    return this.mcp.states(configs)
  }

  async setMcpServers(configs: McpServerConfig[]): Promise<McpServerState[]> {
    validateMcpConfigs(configs)
    const sanitized = this.protectMcpSecrets(configs)
    this.settings.setJson('mcpServers', sanitized)
    await this.mcp.synchronize(this.materializeMcpConfigs(sanitized))
    writeAudit('mcp-settings-updated', JSON.stringify(redact(configs.map((config) => ({ ...config, transport: { ...config.transport, headers: undefined, env: undefined } })))))
    return this.mcp.states(sanitized)
  }

  async shutdown(): Promise<void> {
    for (const sessionId of this.active.keys()) this.cancel(sessionId)
    const stores = await Promise.allSettled(this.knowledgeStores.values())
    await Promise.allSettled(stores.flatMap((result) => result.status === 'fulfilled' ? [result.value.close()] : []))
    this.knowledgeStores.clear()
    await this.mcp.close()
  }

  getKnowledgeSettings(): KnowledgeSettings {
    const stored = this.readKnowledgeSettings()
    return { ...stored, apiKeyConfigured: this.settings.hasSecret('knowledge:embeddingApiKey') }
  }

  async setKnowledgeSettings(
    patch: Partial<Omit<KnowledgeSettings, 'apiKeyConfigured'>>,
    apiKey?: string
  ): Promise<KnowledgeSettings> {
    const current = this.readKnowledgeSettings()
    const next: StoredKnowledgeSettings = {
      mode: patch.mode ?? current.mode,
      baseUrl: patch.baseUrl?.trim() ?? current.baseUrl,
      model: patch.model?.trim() ?? current.model,
      dimensions: patch.dimensions ?? current.dimensions
    }
    if (!['auto', 'remote', 'local'].includes(next.mode)) throw new Error('Embedding 模式无效')
    if (!Number.isInteger(next.dimensions) || next.dimensions < 16 || next.dimensions > 8192) {
      throw new Error('Embedding 维度必须是 16 到 8192 之间的整数')
    }
    if (next.mode === 'remote' && (!next.baseUrl || !next.model)) throw new Error('远程 Embedding 需要 Base URL 和模型名')
    if (next.baseUrl) {
      const url = new URL(next.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Embedding Base URL 必须使用 HTTP(S)')
    }
    this.settings.setJson('knowledge:embedding', next)
    if (apiKey !== undefined) this.settings.setSecret('knowledge:embeddingApiKey', apiKey.trim())
    const embedding = this.materializeEmbeddingConfig(next)
    for (const pending of this.knowledgeStores.values()) {
      const result = await Promise.resolve(pending).catch(() => null)
      result?.setEmbeddingProvider(embedding)
    }
    writeAudit('knowledge-settings-updated', JSON.stringify(redact({ ...next, apiKeyConfigured: Boolean(apiKey?.trim()) || this.settings.hasSecret('knowledge:embeddingApiKey') })))
    return this.getKnowledgeSettings()
  }

  async listKnowledgeBases(sessionId: string): Promise<KnowledgeBaseRecord[]> {
    return (await this.knowledgeForSession(sessionId)).listKnowledgeBases()
  }

  async createKnowledgeBase(sessionId: string, name: string, description = ''): Promise<KnowledgeBaseRecord> {
    const record = await (await this.knowledgeForSession(sessionId)).createKnowledgeBase(name, description)
    writeAudit('knowledge-base-created', JSON.stringify({ id: record.id, name: record.name }), sessionId)
    return record
  }

  async deleteKnowledgeBase(sessionId: string, id: string): Promise<boolean> {
    const deleted = await (await this.knowledgeForSession(sessionId)).deleteKnowledgeBase(id)
    if (deleted) writeAudit('knowledge-base-deleted', JSON.stringify({ id }), sessionId)
    return deleted
  }

  async listKnowledgeDocuments(sessionId: string, knowledgeBaseId?: string): Promise<KnowledgeDocumentRecord[]> {
    return (await this.knowledgeForSession(sessionId)).listDocuments(knowledgeBaseId)
  }

  async importKnowledgeDocument(sessionId: string, knowledgeBaseId: string, path: string): Promise<KnowledgeDocumentRecord> {
    const record = await (await this.knowledgeForSession(sessionId)).importDocument({ knowledgeBaseId, path })
    writeAudit('knowledge-document-imported', JSON.stringify({ id: record.id, source: record.source }), sessionId)
    return record
  }

  async importKnowledgeUrl(sessionId: string, knowledgeBaseId: string, url: string): Promise<KnowledgeDocumentRecord> {
    const record = await (await this.knowledgeForSession(sessionId)).importUrl({ knowledgeBaseId, url })
    writeAudit('knowledge-url-imported', JSON.stringify({ id: record.id, source: record.source }), sessionId)
    return record
  }

  async deleteKnowledgeDocument(sessionId: string, id: string): Promise<boolean> {
    const deleted = await (await this.knowledgeForSession(sessionId)).deleteDocument(id)
    if (deleted) writeAudit('knowledge-document-deleted', JSON.stringify({ id }), sessionId)
    return deleted
  }

  async rebuildKnowledgeBase(sessionId: string, id: string): Promise<KnowledgeDocumentRecord[]> {
    const records = await (await this.knowledgeForSession(sessionId)).rebuildKnowledgeBase(id)
    writeAudit('knowledge-base-rebuilt', JSON.stringify({ id, documents: records.length }), sessionId)
    return records
  }

  async searchKnowledge(sessionId: string, query: string, knowledgeBaseId?: string): Promise<KnowledgeSearchHit[]> {
    return (await this.knowledgeForSession(sessionId)).search(query, { knowledgeBaseId })
  }

  async listMemory(sessionId: string, scope?: MemoryScope): Promise<MemoryEntry[]> {
    return this.memoryForSession(sessionId).list(scope)
  }

  async addMemory(sessionId: string, scope: MemoryScope, content: string): Promise<MemoryEntry> {
    const record = await this.memoryForSession(sessionId).add(scope, content)
    writeAudit('memory-added', JSON.stringify({ id: record.id, scope }), sessionId)
    return record
  }

  async updateMemory(sessionId: string, id: string, content: string): Promise<MemoryEntry> {
    const record = await this.memoryForSession(sessionId).update(id, content)
    writeAudit('memory-updated', JSON.stringify({ id: record.id, scope: record.scope }), sessionId)
    return record
  }

  async deleteMemory(sessionId: string, id: string): Promise<boolean> {
    const deleted = await this.memoryForSession(sessionId).delete(id)
    if (deleted) writeAudit('memory-deleted', JSON.stringify({ id }), sessionId)
    return deleted
  }

  async searchMemory(sessionId: string, query: string, scope?: MemoryScope): Promise<MemorySearchHit[]> {
    return this.memoryForSession(sessionId).search(query, { scope })
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

  private getMemoryStore(workspacePath: string): MemoryStore {
    const key = join(workspacePath)
    const current = this.memoryStores.get(key)
    if (current) return current
    const store = new MemoryStore({ workspacePath })
    this.memoryStores.set(key, store)
    return store
  }

  private getKnowledgeStore(workspacePath: string): Promise<KnowledgeStore> {
    const key = join(workspacePath)
    const current = this.knowledgeStores.get(key)
    if (current) return current
    const store = KnowledgeStore.open({ workspacePath, embedding: this.materializeEmbeddingConfig(this.readKnowledgeSettings()) })
    this.knowledgeStores.set(key, store)
    void store.catch(() => this.knowledgeStores.delete(key))
    return store
  }

  private knowledgeForSession(sessionId: string): Promise<KnowledgeStore> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在: ${sessionId}`)
    return this.getKnowledgeStore(session.workspacePath)
  }

  private memoryForSession(sessionId: string): MemoryStore {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在: ${sessionId}`)
    return this.getMemoryStore(session.workspacePath)
  }

  private readKnowledgeSettings(): StoredKnowledgeSettings {
    return this.settings.getJson<StoredKnowledgeSettings>('knowledge:embedding', {
      mode: 'local',
      baseUrl: '',
      model: '',
      dimensions: 384
    })
  }

  private materializeEmbeddingConfig(stored: StoredKnowledgeSettings): EmbeddingConfig {
    return {
      ...stored,
      apiKey: this.settings.getSecret('knowledge:embeddingApiKey')
    }
  }

  private resolveShell(): ShellSettings {
    const configured = this.settings.getJson<Partial<ShellSettings>>('shell', {})
    if (configured.executable && Array.isArray(configured.args)) return { executable: configured.executable, args: configured.args }
    return process.platform === 'win32'
      ? { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] }
      : { executable: process.env.SHELL || '/bin/sh', args: ['-lc'] }
  }

  private protectMcpSecrets(configs: McpServerConfig[]): McpServerConfig[] {
    return configs.map((config) => {
      const copy = structuredClone(config)
      const secretNames = this.settings.getJson<string[]>(`mcp:${copy.id}:secretNames`, [])
      const values = copy.transport.type === 'stdio' ? copy.transport.env : copy.transport.headers
      if (values) {
        for (const [key, value] of Object.entries(values)) {
          if (!/(authorization|api[-_]?key|password|secret|token)/i.test(key)) continue
          this.settings.setSecret(`mcp:${copy.id}:${key}`, value)
          if (!secretNames.includes(key)) secretNames.push(key)
          delete values[key]
        }
      }
      this.settings.setJson(`mcp:${copy.id}:secretNames`, secretNames)
      return copy
    })
  }

  private materializeMcpConfigs(configs: McpServerConfig[]): McpServerConfig[] {
    return configs.map((config) => {
      const copy = structuredClone(config)
      const secretNames = this.settings.getJson<string[]>(`mcp:${copy.id}:secretNames`, [])
      if (secretNames.length === 0) return copy
      if (copy.transport.type === 'stdio') copy.transport.env ??= {}
      else copy.transport.headers ??= {}
      const target = copy.transport.type === 'stdio' ? copy.transport.env! : copy.transport.headers!
      for (const name of secretNames) {
        const value = this.settings.getSecret(`mcp:${copy.id}:${name}`)
        if (value) target[name] = value
      }
      return copy
    })
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

function asPromptPayload(value: unknown, fallbackContent: string, fallbackAttachments: ContentPart[]): { content: string; attachments: ContentPart[] } {
  if (!value || typeof value !== 'object') return { content: fallbackContent, attachments: fallbackAttachments }
  const record = value as Record<string, unknown>
  return {
    content: typeof record.content === 'string' ? record.content : fallbackContent,
    attachments: Array.isArray(record.attachments) ? (record.attachments as ContentPart[]) : fallbackAttachments
  }
}

function validateMcpConfigs(configs: McpServerConfig[]): void {
  const ids = new Set<string>()
  for (const config of configs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(config.id)) throw new Error(`MCP ID 无效: ${config.id}`)
    if (ids.has(config.id)) throw new Error(`MCP ID 重复: ${config.id}`)
    ids.add(config.id)
    if (!config.name.trim()) throw new Error(`MCP ${config.id} 缺少名称`)
    if (config.transport.type === 'stdio' && !config.transport.command.trim()) throw new Error(`MCP ${config.id} 缺少启动命令`)
    if (config.transport.type !== 'stdio') {
      const url = new URL(config.transport.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`MCP ${config.id} URL 必须使用 HTTP(S)`)
    }
  }
}

function formatMemorySection(userMemory: string, workspaceMemory: string): string {
  return [
    `## 用户级长期记忆\n\n${userMemory.trim() || '当前没有用户级长期记忆。'}`,
    `## 工作区长期记忆\n\n${workspaceMemory.trim() || '当前没有工作区长期记忆。'}`
  ].join('\n\n')
}

function summarizeSession(events: SessionEvent[]): string {
  const messages = events
    .filter((event) => event.type === 'userMessage' || event.type === 'assistantMessage')
    .slice(-8)
    .map((event) => event.type === 'userMessage'
      ? `用户：${event.content.trim()}`
      : `衔星：${event.text.trim()}`)
    .filter((value) => !value.endsWith('：'))
  const content = messages.join('\n\n')
  const maximum = 12_000
  return content.length <= maximum ? content : `[较早内容已省略]\n\n${content.slice(-maximum)}`
}
