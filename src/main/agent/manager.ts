import { join } from 'node:path'
import { app } from 'electron'
import { loadDangerousRules } from '../security/dangerous-rules'
import type { ContentPart, ErrorEvent, PermissionMode, SessionEvent, UsageEvent } from '@core/events'
import { BUILTIN_MODELS, getModel, type ModelConfig, type ModelPricing, type ThinkingLevel } from '@core/models'
import { nanoid } from '@core/nanoid'
import { PermissionService } from '@core/permission'
import { BUILTIN_DANGEROUS_RULES } from '@core/permission/dangerous-rules'
import type { PermissionRule, RuleScope } from '@core/permission/rules'
import { AgentLoop, type PermissionConfirmationRequest, type PermissionResponse } from './loop'
import { OpenAiCompatibleProvider } from '../provider/openai-provider'
import { PromptAssembler, assemblePromptTemplate } from '../prompts/assembler'
import { redact } from '../security/redact'
import { SettingsService } from '../security/settings'
import { getUsageByModel, getUsageSummary, listAudit, listWhitelist, recordUsage, upsertWhitelist, writeAudit } from '../session/database'
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
import type { ToolRegistry } from '@core/tools/registry'
import { canonicalJson, PrefixFingerprintTracker } from '../provider/canonical'
import { validateModelConfig } from '@core/model-validation'
import type { CacheDiagnostic, CompactionConfirmationRequest } from './loop'
import { registerTodoTools } from '../tools/todo'
import { registerSandboxTools } from '../tools/sandbox'
import { registerTaskTools, type SubagentRequest, type SubagentResult } from '../tools/task'
import { createVideoFrameExtractor } from '../media/frames'
import { estimateCost, sumCost } from './usage-cost'
import type { ToolContext } from '@core/tools/types'

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

/** 按模型聚合的用量与估算费用 */
export interface UsageModelCostDto {
  model: string
  promptTokens: number
  cachedTokens: number
  outputTokens: number
  requests: number
  /** 估算费用（¥）；模型未配置单价时为 null */
  estimatedCost: number | null
}

/** 用量统计报表（主会话口径 + 子代理独立统计） */
export interface UsageReportDto {
  promptTokens: number
  cachedTokens: number
  uncachedTokens: number
  outputTokens: number
  hitRate: number
  avoidableMisses: number
  ttlMisses: number
  compactionMisses: number
  byModel: UsageModelCostDto[]
  totalEstimatedCost: number
  pricingConfigured: boolean
  subagent: { promptTokens: number; cachedTokens: number; outputTokens: number; requests: number; estimatedCost: number }
}

interface PendingPermission {
  sessionId: string
  resolve: (response: PermissionResponse) => void
  request: PermissionPromptDto
}

export interface CompactionPromptDto extends CompactionConfirmationRequest {
  requestId: string
  sessionId: string
}

interface PendingCompaction {
  sessionId: string
  resolve: (accepted: boolean) => void
}

interface SessionRuntime {
  model: ModelConfig
  registry: ToolRegistry
  memory: MemoryStore
  skills: SkillManager
  permissions: PermissionService
  hooks: HookRunner
  systemPrompt: string
  skillsIndex: string
}

export type AgentEventSink =
  | { type: 'session/event'; sessionId: string; event: SessionEvent }
  | { type: 'agent/status'; sessionId: string; status: 'idle' | 'running' | 'waiting-confirmation' }
  | { type: 'permission/request'; sessionId: string; request: PermissionPromptDto }
  | { type: 'compaction/request'; sessionId: string; request: CompactionPromptDto }
  | { type: 'agent/delta'; sessionId: string; text?: string; thinking?: string }
  | { type: 'context/status'; sessionId: string; status: import('./context').ContextStatus }
  | { type: 'cache/diagnostic'; sessionId: string; diagnostic: CacheDiagnostic }

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
  private readonly starting = new Set<string>()
  private readonly cancelledStarts = new Set<string>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly pendingCompactions = new Map<string, PendingCompaction>()
  private readonly provider = new OpenAiCompatibleProvider()
  private videoFrameExtractor?: (source: string, mimeType?: string) => Promise<string[]>
  private readonly mcp = new McpManager()
  private readonly knowledgeStores = new Map<string, Promise<KnowledgeStore>>()
  private readonly memoryStores = new Map<string, MemoryStore>()
  private readonly sessionRuntimes = new Map<string, Promise<SessionRuntime>>()
  private readonly prefixTrackers = new Map<string, PrefixFingerprintTracker>()

  constructor(
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly push: (event: AgentEventSink) => void,
    private readonly browser?: BrowserAutomation
  ) {}

  async send(sessionId: string, content: string, attachments: ContentPart[] = [], thinkingLevel: ThinkingLevel = 'max', fileRefs: string[] = []): Promise<void> {
    if (this.active.has(sessionId) || this.starting.has(sessionId)) throw new Error('当前会话已有任务正在运行')
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在: ${sessionId}`)
    this.starting.add(sessionId)
    this.push({ type: 'agent/status', sessionId, status: 'running' })
    let loop: AgentLoop | null = null
    try {
      const runtime = await this.getSessionRuntime(session, thinkingLevel)
      if (this.cancelledStarts.has(sessionId)) throw new Error('任务已取消。')
      const { model, registry, memory, skills, permissions, hooks } = runtime
      const apiKey = this.settings.getSecret(`model:${model.id}:apiKey`) || process.env.STARBIT_API_KEY || ''
      if (!apiKey && model.apiKeyRequired !== false) throw new Error(`模型 ${model.id} 尚未配置 API Key，请在设置中完成配置。`)
      permissions.setMode(session.mode)
      permissions.setRules(listWhitelist())
      const directSkillContext = content.trim() === '/compact' ? '' : await skills.directContext(content)
      const promptHook = await hooks.run('UserPromptSubmit', {
        sessionId,
        workspacePath: session.workspacePath,
        payload: { content, attachments }
      })
      if (!promptHook.allowed) throw new Error(promptHook.messages.join('\n') || 'UserPromptSubmit Hook 已阻断消息')
      const hookedPrompt = asPromptPayload(promptHook.payload, content, attachments)
      if (this.cancelledStarts.has(sessionId)) throw new Error('任务已取消。')
      loop = new AgentLoop({
        sessionId,
        workspacePath: session.workspacePath,
        model,
        apiKey,
        thinkingLevel,
        systemPrompt: runtime.systemPrompt,
        skillsIndex: runtime.skillsIndex,
        registry,
        permissions,
        provider: this.provider,
        initialEvents: this.sessions.replay(sessionId),
        prefixTracker: this.getPrefixTracker(sessionId),
        compactionModel: this.resolveCompactionModel(model),
        compactionApiKey: this.resolveCompactionApiKey(),
        videoFrameExtractor: this.resolveVideoFrameExtractor(),
        onEvent: (event) => this.recordEvent(event),
        onDelta: (delta) => this.push({ type: 'agent/delta', sessionId, ...delta }),
        onContextStatus: (status) => this.push({ type: 'context/status', sessionId, status }),
        onCacheDiagnostic: (diagnostic) => this.push({ type: 'cache/diagnostic', sessionId, diagnostic }),
        confirm: (request) => this.requestPermission(sessionId, request),
        confirmCompaction: (request) => this.requestCompaction(sessionId, request),
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
        },
        beforeCompact: async (request) => {
          const result = await hooks.run('PreCompact', { sessionId, workspacePath: session.workspacePath, payload: request })
          return { allowed: result.allowed, reason: result.messages.join('\n') }
        }
      })
      this.active.set(sessionId, loop)
      this.starting.delete(sessionId)
      await hooks.run('SessionStart', { sessionId, workspacePath: session.workspacePath, payload: { resumed: this.sessions.replay(sessionId).length > 0 } })
      await loop.run(
        hookedPrompt.content,
        hookedPrompt.attachments,
        directSkillContext ? `<loaded-skill>\n${directSkillContext}\n</loaded-skill>` : '',
        fileRefs
      )
      await memory.saveSessionSummary(sessionId, summarizeSession(this.sessions.replay(sessionId)))
      await hooks.run('SessionEnd', { sessionId, workspacePath: session.workspacePath, payload: { status: 'completed' } })
    } catch (error) {
      if (!loop) this.recordEvent(this.errorEvent(sessionId, error))
      throw error
    } finally {
      this.starting.delete(sessionId)
      this.cancelledStarts.delete(sessionId)
      this.active.delete(sessionId)
      this.push({ type: 'agent/status', sessionId, status: 'idle' })
    }
  }

  cancel(sessionId: string): void {
    if (this.starting.has(sessionId)) this.cancelledStarts.add(sessionId)
    this.active.get(sessionId)?.cancel()
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) {
        pending.resolve({ outcome: 'deny', scope: 'once', reason: '任务已取消' })
        this.pendingPermissions.delete(requestId)
      }
    }
    for (const [requestId, pending] of this.pendingCompactions) {
      if (pending.sessionId === sessionId) {
        pending.resolve(false)
        this.pendingCompactions.delete(requestId)
      }
    }
  }

  respondPermission(requestId: string, outcome: 'allow' | 'deny', scope: RuleScope, reason?: string): boolean {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    pending.resolve({ outcome, scope, reason })
    this.pendingPermissions.delete(requestId)
    const next = [...this.pendingPermissions.values()].find((item) => item.sessionId === pending.sessionId)
    if (next?.request) this.push({ type: 'permission/request', sessionId: pending.sessionId, request: next.request })
    else this.push({ type: 'agent/status', sessionId: pending.sessionId, status: 'running' })
    return true
  }

  respondCompaction(requestId: string, accepted: boolean): boolean {
    const pending = this.pendingCompactions.get(requestId)
    if (!pending) return false
    pending.resolve(accepted)
    this.pendingCompactions.delete(requestId)
    this.push({ type: 'agent/status', sessionId: pending.sessionId, status: 'running' })
    return true
  }

  usageSummary(sessionId?: string): UsageReportDto {
    const summary = getUsageSummary(sessionId)
    const models = this.listModels()
    const priceOf = (id: string): ModelPricing | undefined => models.find((model) => model.id === id)?.pricing
    const buildRows = (isSubagent: boolean): UsageModelCostDto[] =>
      getUsageByModel(isSubagent, sessionId).map((row) => ({ ...row, estimatedCost: estimateCost(row, priceOf(row.model)) }))
    const byModel = buildRows(false)
    const subagentRows = buildRows(true)
    const subagent = {
      promptTokens: subagentRows.reduce((total, row) => total + row.promptTokens, 0),
      cachedTokens: subagentRows.reduce((total, row) => total + row.cachedTokens, 0),
      outputTokens: subagentRows.reduce((total, row) => total + row.outputTokens, 0),
      requests: subagentRows.reduce((total, row) => total + row.requests, 0),
      estimatedCost: sumCost(subagentRows)
    }
    return {
      ...summary,
      byModel,
      totalEstimatedCost: sumCost(byModel),
      pricingConfigured: byModel.length > 0 && byModel.every((row) => row.estimatedCost !== null),
      subagent
    }
  }

  audit(limit?: number, sessionId?: string): ReturnType<typeof listAudit> {
    return listAudit(limit, sessionId)
  }

  setModelApiKey(modelId: string, apiKey: string): void {
    if (!this.listModels().some((model) => model.id === modelId)) throw new Error(`未知模型: ${modelId}`)
    this.settings.setSecret(`model:${modelId}:apiKey`, apiKey.trim())
    writeAudit('model-api-key-updated', JSON.stringify({ modelId, configured: Boolean(apiKey.trim()) }))
  }

  isModelConfigured(modelId: string): boolean {
    return this.settings.hasSecret(`model:${modelId}:apiKey`) || Boolean(process.env.STARBIT_API_KEY)
  }

  listModels(): ModelConfig[] {
    const custom = this.settings.getJson<ModelConfig[]>('customModels', [])
    return [...BUILTIN_MODELS.map((model) => ({
      ...model, ...this.settings.getJson<Partial<ModelConfig>>(`model:${model.id}:override`, {}), id: model.id, custom: false
    })), ...custom]
  }

  saveModel(value: ModelConfig): ModelConfig[] {
    const model = validateModelConfig(value)
    if (getModel(model.id)) this.settings.setJson(`model:${model.id}:override`, { ...model, custom: false })
    else {
      const custom = this.settings.getJson<ModelConfig[]>('customModels', []).filter((item) => item.id !== model.id)
      this.settings.setJson('customModels', [...custom, { ...model, custom: true }])
    }
    writeAudit('model-config-updated', JSON.stringify({ id: model.id, apiShape: model.apiShape }))
    return this.listModels()
  }

  deleteModel(id: string): ModelConfig[] {
    if (getModel(id)) this.settings.setJson(`model:${id}:override`, {})
    else this.settings.setJson('customModels', this.settings.getJson<ModelConfig[]>('customModels', []).filter((item) => item.id !== id))
    writeAudit('model-config-removed', JSON.stringify({ id }))
    return this.listModels()
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

  /** 压缩摘要独立小模型（未配置时回退主模型）。 */
  getCompactionSettings(): { modelId: string | null } {
    return { modelId: this.settings.getString('compaction:modelId', '') || null }
  }

  setCompactionSettings(patch: { modelId?: string | null }): void {
    if (!('modelId' in patch)) return
    const modelId = patch.modelId?.trim() ?? ''
    if (modelId) this.resolveModel(modelId)
    this.settings.setString('compaction:modelId', modelId)
    writeAudit('compaction-settings-updated', JSON.stringify({ modelId: modelId || null }))
  }

  /** 视频抽帧设置（ffmpeg 路径；留空使用 PATH 中的 ffmpeg）。 */
  getVideoSettings(): { ffmpegPath: string } {
    return { ffmpegPath: this.settings.getString('video:ffmpegPath', '') }
  }

  setVideoSettings(patch: { ffmpegPath?: string }): void {
    if (!('ffmpegPath' in patch)) return
    this.settings.setString('video:ffmpegPath', patch.ffmpegPath?.trim() ?? '')
    writeAudit('video-settings-updated', JSON.stringify({ ffmpegPath: patch.ffmpegPath?.trim() || null }))
  }

  private resolveCompactionModel(fallback: ModelConfig): ModelConfig {
    const modelId = this.settings.getString('compaction:modelId', '')
    if (!modelId) return fallback
    return this.listModels().find((model) => model.id === modelId) ?? fallback
  }

  private resolveCompactionApiKey(): string | undefined {
    const modelId = this.settings.getString('compaction:modelId', '')
    if (!modelId) return undefined
    return this.settings.getSecret(`model:${modelId}:apiKey`) || undefined
  }

  /** 视频抽帧实现；ffmpeg 路径可在设置中调整，惰性创建以跟随最新配置。 */
  private resolveVideoFrameExtractor(): (source: string, mimeType?: string) => Promise<string[]> {
    const ffmpegPath = this.settings.getString('video:ffmpegPath', '')
    if (!this.videoFrameExtractor || this.extractorFfmpegPath !== ffmpegPath) {
      this.extractorFfmpegPath = ffmpegPath
      this.videoFrameExtractor = createVideoFrameExtractor({ ffmpegPath })
    }
    return this.videoFrameExtractor
  }

  private extractorFfmpegPath?: string

  /** 读取权限相关设置（计划文档规则等）。 */
  getPermissionSettings(): { planDocPattern: string | null } {
    return { planDocPattern: this.settings.getString('permission:planDocPattern', '') || null }
  }

  /** 更新权限设置并即时应用到已存在的会话运行时。 */
  setPermissionSettings(patch: { planDocPattern?: string | null }): void {
    if ('planDocPattern' in patch) {
      const source = patch.planDocPattern?.trim() ?? ''
      if (source) new RegExp(source, 'i')
      this.settings.setString('permission:planDocPattern', source)
      const pattern = source || null
      for (const pending of this.sessionRuntimes.values()) {
        void pending.then((runtime) => runtime.permissions.setPlanDocPattern(pattern)).catch(() => undefined)
      }
      writeAudit('permission-settings-updated', JSON.stringify({ planDocPattern: source || null }))
    }
  }

  /** 新增一条永久白名单规则（设置面板编辑入口）。 */
  addPermissionRule(input: { semanticLabel: string; pattern: string; action: 'allow' | 'deny' | 'ask' }): PermissionRule {
    const semanticLabel = input.semanticLabel.trim()
    const pattern = input.pattern.trim()
    if (!semanticLabel) throw new Error('工具语义标签不能为空')
    if (!pattern) throw new Error('匹配规则不能为空')
    const rule: PermissionRule = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      semanticLabel,
      pattern,
      action: input.action,
      scope: 'permanent',
      createdAt: Date.now()
    }
    upsertWhitelist(rule)
    writeAudit('permission-rule-added', JSON.stringify(redact(rule)))
    return rule
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
    await this.resetCaches()
    await this.mcp.close()
  }

  /** 数据导入后清空会话运行时与知识库缓存，保证后续请求基于新数据重建。 */
  async resetCaches(): Promise<void> {
    for (const sessionId of this.active.keys()) this.cancel(sessionId)
    const stores = await Promise.allSettled(this.knowledgeStores.values())
    await Promise.allSettled(stores.flatMap((result) => result.status === 'fulfilled' ? [result.value.close()] : []))
    this.knowledgeStores.clear()
    this.sessionRuntimes.clear()
    this.prefixTrackers.clear()
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
    if (!apiKey && model.apiKeyRequired !== false) return { ok: false, latencyMs: 0, message: '尚未配置 API Key' }
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
    const selected = this.listModels().find((model) => model.id === id || (!id && model.id === 'qwen3.8-max'))
    if (!selected) throw new Error(`模型不存在：${id}，请在设置中选择可用模型。`)
    return selected
  }

  private async getSessionRuntime(
    session: NonNullable<ReturnType<SessionManager['get']>>,
    thinkingLevel: ThinkingLevel
  ): Promise<SessionRuntime> {
    const existing = this.sessionRuntimes.get(session.id)
    if (existing) {
      const runtime = await existing
      if (canonicalJson(runtime.model as unknown as import('@core/types').JsonValue) === canonicalJson(this.resolveModel(session.model) as unknown as import('@core/types').JsonValue)) return runtime
      this.sessionRuntimes.delete(session.id)
      this.prefixTrackers.delete(session.id)
    }
    const pending = this.createSessionRuntime(session, thinkingLevel)
    this.sessionRuntimes.set(session.id, pending)
    try {
      return await pending
    } catch (error) {
      this.sessionRuntimes.delete(session.id)
      throw error
    }
  }

  private async createSessionRuntime(
    session: NonNullable<ReturnType<SessionManager['get']>>,
    thinkingLevel: ThinkingLevel
  ): Promise<SessionRuntime> {
    const model = this.resolveModel(session.model)
    const registry = createBuiltinToolRegistry({ shell: this.resolveShell() })
    if (this.browser) registerBrowserTools(registry, this.browser)
    const [knowledge, memory] = await Promise.all([
      this.getKnowledgeStore(session.workspacePath),
      Promise.resolve(this.getMemoryStore(session.workspacePath))
    ])
    registerKnowledgeTools(registry, knowledge)
    registerMemoryTools(registry, memory)
    registerTodoTools(registry)
    registerSandboxTools(registry, {
      nodeExecutable: process.execPath,
      pythonExecutable: this.settings.getString('sandbox:pythonExecutable', process.platform === 'win32' ? 'python.exe' : 'python3')
    })
    registerTaskTools(registry, (request, context) => this.runSubagent(request, context, model, registry))
    const mcpConfigs = this.materializeMcpConfigs(this.settings.getJson<McpServerConfig[]>('mcpServers', []))
    await this.mcp.synchronize(mcpConfigs)
    this.mcp.registerTools(registry)
    const skills = new SkillManager({ workspacePath: session.workspacePath })
    await skills.scan()
    skills.registerTools(registry)
    const permissions = new PermissionService(await this.loadPermissionRules())
    permissions.setMode(session.mode)
    permissions.setRules(listWhitelist())
    permissions.setPlanDocPattern(this.getPermissionSettings().planDocPattern)
    const memoryContext = await memory.loadContext()
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
    return {
      model,
      registry,
      memory,
      skills,
      permissions,
      hooks,
      systemPrompt: assembled.systemPrompt,
      skillsIndex: assembled.skillsIndex
    }
  }

  private getPrefixTracker(sessionId: string): PrefixFingerprintTracker {
    const current = this.prefixTrackers.get(sessionId)
    if (current) return current
    const tracker = new PrefixFingerprintTracker()
    this.prefixTrackers.set(sessionId, tracker)
    return tracker
  }

  private async loadPermissionRules(): Promise<typeof BUILTIN_DANGEROUS_RULES> {
    const custom = await loadDangerousRules([
      join(app.getAppPath(), 'resources', 'dangerous-rules.yaml'),
      join(app.getPath('userData'), 'dangerous-rules.yaml')
    ])
    // 用户规则只增补；不得用同名 warn 规则削弱内置 block 规则。
    return [...BUILTIN_DANGEROUS_RULES, ...custom]
  }

  private async runSubagent(
    request: SubagentRequest,
    parentContext: ToolContext,
    model: ModelConfig,
    parentRegistry: ToolRegistry
  ): Promise<SubagentResult> {
    const id = nanoid('subagent')
    const requested = request.allowedTools ? new Set(request.allowedTools) : null
    const registry = parentRegistry.fork((definition) => {
      if (definition.fullName === 'Task') return false
      if (requested && !requested.has(definition.fullName)) return false
      return request.type === 'explore' ? definition.readOnly === true : true
    })
    if (requested) {
      const missing = [...requested].filter((name) => !registry.has(name))
      if (missing.length) throw new Error(`子代理工具不可用或不符合类型约束: ${missing.join(', ')}`)
    }
    const permissions = new PermissionService(await this.loadPermissionRules())
    permissions.setMode(request.type === 'explore' ? 'plan' : parentContext.mode as PermissionMode)
    permissions.setRules(listWhitelist())
    permissions.setPlanDocPattern(this.getPermissionSettings().planDocPattern)
    const apiKey = this.settings.getSecret(`model:${model.id}:apiKey`) || process.env.STARBIT_API_KEY || ''
    if (!apiKey && model.apiKeyRequired !== false) throw new Error(`模型 ${model.id} 尚未配置 API Key`)
    const systemPrompt = await assemblePromptTemplate('subagent.md', {
      type: request.type,
      workspacePath: parentContext.workspacePath
    })
    let latest = ''
    const loop = new AgentLoop({
      sessionId: id,
      workspacePath: parentContext.workspacePath,
      model,
      apiKey,
      thinkingLevel: 'high',
      systemPrompt,
      skillsIndex: '子代理使用主会话冻结后的工具白名单。',
      registry,
      permissions,
      provider: this.provider,
      maxToolRounds: 8,
      isSubagent: true,
      onEvent: (event) => {
        if (event.type === 'assistantMessage' && event.text.trim()) latest = event.text.trim()
        if (event.type === 'usage') {
          recordUsage({
            id: event.id,
            sessionId: parentContext.sessionId,
            model: event.model,
            promptTokens: event.promptTokens,
            cachedTokens: event.cachedTokens,
            outputTokens: event.outputTokens,
            hitRate: event.hitRate,
            missCategory: event.missCategory,
            isSubagent: true
          })
        }
      },
      confirm: (confirmation) => this.requestPermission(parentContext.sessionId, confirmation)
    })
    const abort = (): void => loop.cancel()
    parentContext.signal?.addEventListener('abort', abort, { once: true })
    try {
      await loop.run(request.prompt)
    } finally {
      parentContext.signal?.removeEventListener('abort', abort)
    }
    writeAudit('subagent-completed', JSON.stringify({ id, type: request.type, tools: registry.listAll().map((tool) => tool.fullName) }), parentContext.sessionId)
    return { id, type: request.type, summary: latest || '子代理已完成，但没有返回文本摘要。' }
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
    const waiting = [...this.pendingPermissions.values()].some((item) => item.sessionId === sessionId)
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, { sessionId, resolve, request: dto })
      this.push({ type: 'agent/status', sessionId, status: 'waiting-confirmation' })
      if (!waiting) this.push({ type: 'permission/request', sessionId, request: dto })
    })
  }

  private requestCompaction(sessionId: string, request: CompactionConfirmationRequest): Promise<boolean> {
    const requestId = nanoid('compact')
    const dto: CompactionPromptDto = { ...request, requestId, sessionId }
    this.push({ type: 'agent/status', sessionId, status: 'waiting-confirmation' })
    this.push({ type: 'compaction/request', sessionId, request: dto })
    return new Promise((resolve) => this.pendingCompactions.set(requestId, { sessionId, resolve }))
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
