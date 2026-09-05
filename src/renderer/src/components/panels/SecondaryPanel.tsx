import { useEffect, useState } from 'react'
import { BookOpen, Brain, FileDown, FileUp, FolderOpen, HardDriveDownload, HardDriveUpload, KeyRound, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import type { AuditDto, McpServerConfigDto, McpServerStateDto, UsageReportDto } from '../../../../main/ipc/types'
import type { PermissionRule } from '@core/permission/rules'
import { useAppStore } from '../../stores/app'
import { KnowledgePanel } from './KnowledgePanel'
import { MemoryPanel } from './MemoryPanel'
import { ModelEditor } from './ModelEditor'
import { FilesPanel } from './FilesPanel'
import './panels.css'

const TITLES: Record<string, string> = {
  sessions: '会话', files: '文件', kb: '知识库', memory: '记忆', mcp: 'MCP 服务器', skills: '技能', usage: '用量统计', audit: '审计日志', settings: '设置'
}

export function SecondaryPanel(): JSX.Element {
  const active = useAppStore((state) => state.activeSection)
  return (
    <aside className="secondary-panel" aria-label={TITLES[active] ?? '功能面板'}>
      <header className="secondary-panel__header">{TITLES[active] ?? active}</header>
      <div className="secondary-panel__body">
        {active === 'sessions' ? <SessionsPanel /> : active === 'settings' ? <SettingsPanel /> : active === 'usage' ? <UsagePanel /> : active === 'audit' ? <AuditPanel /> : active === 'skills' ? <SkillsPanel /> : active === 'mcp' ? <McpPanel /> : active === 'kb' ? <KnowledgePanel /> : active === 'memory' ? <MemoryPanel /> : active === 'files' ? <FilesPanel /> : <ComingPanel title={TITLES[active] ?? active} />}
      </div>
    </aside>
  )
}

function SessionsPanel(): JSX.Element {
  const sessions = useAppStore((state) => state.sessions)
  const currentSessionId = useAppStore((state) => state.currentSessionId)

  const createSession = async (): Promise<void> => {
    const selected = await window.starbit.workspace.selectFolder()
    if (!selected) return
    const state = useAppStore.getState()
    const session = await window.starbit.session.create(selected.path, { model: state.currentModel, mode: state.mode })
    state.setWorkspacePath(selected.path)
    state.setSessions([session, ...state.sessions])
    state.setCurrentSessionId(session.id, [])
  }

  const selectSession = async (id: string): Promise<void> => {
    const [session, events] = await Promise.all([window.starbit.session.get(id), window.starbit.session.replay(id)])
    if (!session) return
    const state = useAppStore.getState()
    state.setCurrentSessionId(id, events)
    state.setWorkspacePath(session.workspacePath)
    state.setModel(session.model || 'qwen3.8-max')
    state.setMode(session.mode)
  }

  return (
    <div className="panel-stack">
      <button className="panel-primary-action" onClick={() => void createSession()}><Plus size={16} /> 新建工作区会话</button>
      <div className="session-list">
        {sessions.map((session) => (
          <button key={session.id} className={`session-item ${currentSessionId === session.id ? 'is-active' : ''}`} onClick={() => void selectSession(session.id)}>
            <span className="session-item__title">{session.title}</span>
            <span className="session-item__path">{session.workspacePath}</span>
          </button>
        ))}
        {sessions.length === 0 && <EmptyText>尚无会话，请先选择工作区。</EmptyText>}
      </div>
    </div>
  )
}

function SettingsPanel(): JSX.Element {
  const models = useAppStore((state) => state.models)
  const currentModel = useAppStore((state) => state.currentModel)
  const currentSessionId = useAppStore((state) => state.currentSessionId)
  const [apiKey, setApiKey] = useState('')
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [shellExecutable, setShellExecutable] = useState('')
  const [shellArgs, setShellArgs] = useState('')
  const [compactionModelId, setCompactionModelId] = useState('')
  const [ffmpegPath, setFfmpegPath] = useState('')
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [ruleLabel, setRuleLabel] = useState('Bash')
  const [rulePattern, setRulePattern] = useState('')
  const [ruleAction, setRuleAction] = useState<'allow' | 'deny' | 'ask'>('allow')
  const [planDocPattern, setPlanDocPattern] = useState('')
  const [embeddingMode, setEmbeddingMode] = useState<'local' | 'auto' | 'remote'>('local')
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState(384)
  const [embeddingApiKey, setEmbeddingApiKey] = useState('')
  const [embeddingKeyConfigured, setEmbeddingKeyConfigured] = useState(false)
  const [reuseLogin, setReuseLogin] = useState(false)
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void Promise.all([
      window.starbit.models.configured(),
      window.starbit.settings.getShell(),
      window.starbit.permission.listRules(),
      window.starbit.permission.getSettings(),
      window.starbit.settings.getCompaction(),
      window.starbit.settings.getVideo(),
      window.starbit.knowledge.getSettings(),
      currentSessionId ? window.starbit.browser.getState(currentSessionId) : Promise.resolve(null)
    ]).then(([keys, shell, nextRules, permission, compaction, video, embedding, browserState]) => {
      setConfigured(keys)
      setShellExecutable(shell.executable)
      setShellArgs(shell.args.join(' '))
      setRules(nextRules)
      setPlanDocPattern(permission.planDocPattern ?? '')
      setCompactionModelId(compaction.modelId ?? '')
      setFfmpegPath(video.ffmpegPath)
      setEmbeddingMode(embedding.mode)
      setEmbeddingBaseUrl(embedding.baseUrl)
      setEmbeddingModel(embedding.model)
      setEmbeddingDimensions(embedding.dimensions)
      setEmbeddingKeyConfigured(embedding.apiKeyConfigured)
      setReuseLogin(browserState?.reuseLogin ?? false)
      setAllowPrivateNetwork(browserState?.allowPrivateNetwork ?? false)
    })
  }, [currentSessionId])

  const saveKey = async (): Promise<void> => {
    await window.starbit.models.setApiKey(currentModel, apiKey)
    setConfigured((value) => ({ ...value, [currentModel]: Boolean(apiKey.trim()) }))
    setApiKey('')
    setMessage('密钥已使用系统凭证加密保存。')
  }

  const test = async (): Promise<void> => {
    setMessage('正在测试连接…')
    const result = await window.starbit.models.testConnection(currentModel)
    setMessage(result.ok ? `连接成功，耗时 ${result.latencyMs}ms。` : result.message)
  }

  const saveShell = async (): Promise<void> => {
    await window.starbit.settings.setShell({ executable: shellExecutable, args: splitArgs(shellArgs) })
    setMessage('Shell 配置已保存。')
  }

  const saveCompaction = async (): Promise<void> => {
    try {
      await window.starbit.settings.setCompaction({ modelId: compactionModelId || null })
      setMessage('压缩摘要模型已保存；下次压缩时生效。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const saveVideo = async (): Promise<void> => {
    await window.starbit.settings.setVideo({ ffmpegPath })
    setMessage('视频抽帧设置已保存。')
  }

  const saveEmbedding = async (): Promise<void> => {
    const result = await window.starbit.knowledge.setSettings({
      mode: embeddingMode,
      baseUrl: embeddingBaseUrl,
      model: embeddingModel,
      dimensions: embeddingDimensions
    }, embeddingApiKey || undefined)
    setEmbeddingKeyConfigured(result.apiKeyConfigured)
    setEmbeddingApiKey('')
    setMessage('知识库 Embedding 配置已保存。已有文档可在知识库面板重建索引。')
  }

  const deleteRule = async (id: string): Promise<void> => {
    await window.starbit.permission.deleteRule(id)
    setRules(await window.starbit.permission.listRules())
    setMessage('权限规则已删除。')
  }

  const addRule = async (): Promise<void> => {
    try {
      await window.starbit.permission.addRule({ semanticLabel: ruleLabel, pattern: rulePattern, action: ruleAction })
      setRules(await window.starbit.permission.listRules())
      setRulePattern('')
      setMessage('权限规则已添加，立即生效。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const savePlanDocPattern = async (): Promise<void> => {
    try {
      await window.starbit.permission.setSettings({ planDocPattern: planDocPattern.trim() || null })
      setMessage('计划文档规则已保存并应用到现有会话。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const updateBrowserSetting = async (kind: 'reuse' | 'private', value: boolean): Promise<void> => {
    if (!currentSessionId) return
    const state = kind === 'reuse'
      ? await window.starbit.browser.setReuseLogin(currentSessionId, value)
      : await window.starbit.browser.setAllowPrivateNetwork(currentSessionId, value)
    setReuseLogin(state.reuseLogin)
    setAllowPrivateNetwork(state.allowPrivateNetwork)
    setMessage('浏览器安全设置已保存到当前会话。')
  }

  const exportSession = async (format: 'markdown' | 'json'): Promise<void> => {
    if (!currentSessionId) return
    const result = await window.starbit.session.export(currentSessionId, format)
    setMessage(result ? `会话已导出到 ${result.path}` : '导出已取消。')
  }

  const importSession = async (): Promise<void> => {
    try {
      const session = await window.starbit.session.import(useAppStore.getState().workspacePath)
      if (session) {
        const state = useAppStore.getState()
        state.setSessions([session, ...state.sessions])
        setMessage(`会话已导入：${session.title}`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const exportData = async (): Promise<void> => {
    const result = await window.starbit.data.export()
    setMessage(result ? `数据已备份到 ${result.path}` : '导出已取消。')
  }

  const importData = async (): Promise<void> => {
    if (!window.confirm('导入备份将覆盖现有会话与设置，且不可撤销。确定继续吗？')) return
    try {
      const result = await window.starbit.data.import()
      if (!result) return
      const sessions = await window.starbit.session.list()
      const state = useAppStore.getState()
      state.setSessions(sessions)
      const first = sessions[0]
      if (first) {
        const [meta, events] = await Promise.all([window.starbit.session.get(first.id), window.starbit.session.replay(first.id)])
        if (meta) {
          state.setCurrentSessionId(meta.id, events)
          state.setWorkspacePath(meta.workspacePath)
          state.setMode(meta.mode)
          state.setModel(meta.model || 'qwen3.8-max')
        }
      } else {
        state.setCurrentSessionId(null, [])
      }
      setMessage('数据导入完成。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="panel-stack">
      <section className="settings-group">
        <h3>模型连接</h3>
        <label>模型</label>
        <select value={currentModel} onChange={(event) => useAppStore.getState().setModel(event.target.value)}>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <label>API Key {configured[currentModel] ? '（已配置）' : '（未配置）'}</label>
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="仅保存到本机" />
        <div className="panel-actions">
          <button className="panel-button" onClick={() => void saveKey()}><KeyRound size={14} /> 保存密钥</button>
          <button className="panel-button" onClick={() => void test()}><RefreshCw size={14} /> 测试连接</button>
        </div>
      </section>
      <section className="settings-group">
        <h3>Shell</h3>
        <label>可执行文件</label>
        <input value={shellExecutable} onChange={(event) => setShellExecutable(event.target.value)} />
        <label>启动参数</label>
        <input value={shellArgs} onChange={(event) => setShellArgs(event.target.value)} />
        <button className="panel-button" onClick={() => void saveShell()}><Save size={14} /> 保存 Shell</button>
      </section>
      <section className="settings-group">
        <h3>上下文压缩</h3>
        <label>摘要模型（留空使用当前主模型；建议选择低成本模型）</label>
        <select value={compactionModelId} onChange={(event) => setCompactionModelId(event.target.value)}>
          <option value="">跟随主模型</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <button className="panel-button" onClick={() => void saveCompaction()}><Save size={14} /> 保存压缩设置</button>
        <label>ffmpeg 路径（视频抽帧降级；留空使用系统 PATH）</label>
        <input value={ffmpegPath} onChange={(event) => setFfmpegPath(event.target.value)} placeholder="ffmpeg" />
        <button className="panel-button" onClick={() => void saveVideo()}><Save size={14} /> 保存视频设置</button>
      </section>
      <ModelEditor />
      <section className="settings-group">
        <h3><ShieldCheck size={15} /> 权限白名单</h3>
        <div className="settings-rule-list">
          {rules.map((rule) => <article key={rule.id}><div><strong>{rule.semanticLabel}({rule.pattern})</strong><span>{rule.action} · {rule.scope} · 命中 {rule.hitCount ?? 0} 次</span></div><button title="删除规则" onClick={() => void deleteRule(rule.id)}><Trash2 size={13} /></button></article>)}
          {rules.length === 0 && <EmptyText>尚无持久化权限规则。</EmptyText>}
        </div>
        <div className="settings-rule-editor">
          <label>工具语义标签</label>
          <input value={ruleLabel} onChange={(event) => setRuleLabel(event.target.value)} placeholder="Bash / Write / Edit" />
          <label>匹配规则（支持 * 通配）</label>
          <input value={rulePattern} onChange={(event) => setRulePattern(event.target.value)} placeholder="npm run * 或 ./docs/**" />
          <label>动作</label>
          <select value={ruleAction} onChange={(event) => setRuleAction(event.target.value as typeof ruleAction)}>
            <option value="allow">允许</option>
            <option value="ask">每次询问</option>
            <option value="deny">拒绝</option>
          </select>
          <button className="panel-button" onClick={() => void addRule()}><Plus size={14} /> 添加规则</button>
        </div>
        <label>计划文档规则（计划模式下放行的 Markdown，正则；留空恢复内置默认）</label>
        <input value={planDocPattern} onChange={(event) => setPlanDocPattern(event.target.value)} placeholder="内置默认：文件名含 计划/plan 的 *.md" />
        <button className="panel-button" onClick={() => void savePlanDocPattern()}><Save size={14} /> 保存计划文档规则</button>
      </section>
      <section className="settings-group">
        <h3><BookOpen size={15} /> 知识库 Embedding</h3>
        <label>运行模式</label>
        <select value={embeddingMode} onChange={(event) => setEmbeddingMode(event.target.value as typeof embeddingMode)}>
          <option value="local">本地离线</option>
          <option value="auto">远程优先，失败回退本地</option>
          <option value="remote">仅远程</option>
        </select>
        {embeddingMode !== 'local' && <>
          <label>OpenAI 兼容 Base URL</label>
          <input value={embeddingBaseUrl} onChange={(event) => setEmbeddingBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
          <label>Embedding 模型</label>
          <input value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} placeholder="text-embedding-model" />
          <label>API Key {embeddingKeyConfigured ? '（已配置）' : '（未配置）'}</label>
          <input type="password" autoComplete="off" value={embeddingApiKey} onChange={(event) => setEmbeddingApiKey(event.target.value)} placeholder="留空则保留现有密钥" />
        </>}
        <label>向量维度</label>
        <input type="number" min={16} max={8192} value={embeddingDimensions} onChange={(event) => setEmbeddingDimensions(Number(event.target.value))} />
        <button className="panel-button" onClick={() => void saveEmbedding()}><Save size={14} /> 保存 Embedding</button>
      </section>
      <section className="settings-group">
        <h3>浏览器安全</h3>
        {currentSessionId ? <>
          <label className="panel-checkbox"><input type="checkbox" checked={reuseLogin} onChange={(event) => void updateBrowserSetting('reuse', event.target.checked)} /> 显式复用登录态</label>
          <label className="panel-checkbox"><input type="checkbox" checked={allowPrivateNetwork} onChange={(event) => void updateBrowserSetting('private', event.target.checked)} /> 允许访问本机与私有网络</label>
        </> : <EmptyText>选择会话后可管理浏览器安全设置。</EmptyText>}
      </section>
      <section className="settings-group">
        <h3><Brain size={15} /> 记忆</h3>
        <p className="panel-message">用户级与工作区级 memory.md 会在每轮自动加载；AGENTS.md 始终只读。</p>
        <button className="panel-button" onClick={() => useAppStore.getState().setActiveSection('memory')}>打开记忆管理</button>
      </section>
      <section className="settings-group">
        <h3>数据管理</h3>
        <div className="panel-actions">
          <button className="panel-button" disabled={!currentSessionId} onClick={() => void exportSession('markdown')}><FileDown size={14} /> 导出当前会话 (Markdown)</button>
          <button className="panel-button" disabled={!currentSessionId} onClick={() => void exportSession('json')}><FileDown size={14} /> 导出当前会话 (JSON)</button>
          <button className="panel-button" onClick={() => void importSession()}><FileUp size={14} /> 导入会话</button>
        </div>
        <div className="panel-actions">
          <button className="panel-button" onClick={() => void exportData()}><HardDriveDownload size={14} /> 导出全部数据</button>
          <button className="panel-button panel-button--danger" onClick={() => void importData()}><HardDriveUpload size={14} /> 导入全部数据（覆盖）</button>
        </div>
        <p className="panel-message">全量备份包含会话、事件、白名单、审计与设置；导入会覆盖现有数据并重载。</p>
      </section>
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function UsagePanel(): JSX.Element {
  const [summary, setSummary] = useState<UsageReportDto | null>(null)
  const diagnostics = useAppStore((state) => state.cacheDiagnostics)
  const currentSessionId = useAppStore((state) => state.currentSessionId)
  const [scopeAll, setScopeAll] = useState(true)
  useEffect(() => {
    void window.starbit.usage.summary(scopeAll ? undefined : currentSessionId ?? undefined).then(setSummary)
  }, [scopeAll, currentSessionId])
  if (!summary) return <EmptyText>正在读取用量…</EmptyText>
  const items = [
    ['总输入', summary.promptTokens], ['缓存命中', summary.cachedTokens], ['未命中', summary.uncachedTokens], ['输出', summary.outputTokens]
  ] as const
  return (
    <div className="panel-stack">
      <div className="usage-rate"><strong>{(summary.hitRate * 100).toFixed(1)}%</strong><span>{scopeAll ? '全局' : '当前会话'}缓存命中率</span></div>
      <div className="usage-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
      <p className="usage-misses">可避免 {summary.avoidableMisses} · TTL {summary.ttlMisses} · 压缩 {summary.compactionMisses}</p>
      <div className="usage-scope-toggle">
        <button className={`panel-button ${scopeAll ? 'is-active' : ''}`} onClick={() => setScopeAll(true)}>全局</button>
        <button className={`panel-button ${!scopeAll ? 'is-active' : ''}`} disabled={!currentSessionId} onClick={() => setScopeAll(false)}>当前会话</button>
      </div>
      <section className="settings-group">
        <h3>按模型费用估算</h3>
        <div className="usage-cost-table">
          {summary.byModel.map((row) => (
            <article key={row.model}>
              <strong>{row.model}</strong>
              <span>输入 {row.promptTokens.toLocaleString()}（命中 {row.cachedTokens.toLocaleString()}）· 输出 {row.outputTokens.toLocaleString()} · {row.requests} 轮</span>
              <em>{row.estimatedCost === null ? '未配置单价' : `¥${row.estimatedCost.toFixed(4)}`}</em>
            </article>
          ))}
          {summary.byModel.length === 0 && <EmptyText>暂无主会话用量。</EmptyText>}
        </div>
        <p className="panel-message">
          估算合计：¥{summary.totalEstimatedCost.toFixed(4)}
          {summary.pricingConfigured ? '（按模型单价估算，非账单）' : '（部分模型未配置单价，合计偏低）'}
        </p>
      </section>
      <section className="settings-group">
        <h3>子代理用量</h3>
        <p className="panel-message">
          输入 {summary.subagent.promptTokens.toLocaleString()}（命中 {summary.subagent.cachedTokens.toLocaleString()}）· 输出 {summary.subagent.outputTokens.toLocaleString()} · {summary.subagent.requests} 轮 · 估算 ¥{summary.subagent.estimatedCost.toFixed(4)}
        </p>
        <p className="panel-message">子代理缓存单独路由，不计入全局命中率目标。</p>
      </section>
      <section className="settings-group">
        <h3>前缀诊断</h3>
        <div className="cache-diagnostic-list">
          {diagnostics.map((diagnostic, index) => (
            <article key={`${diagnostic.requestFingerprint}-${index}`} className={diagnostic.changedSections.length > 0 ? 'is-changed' : ''}>
              <header>
                <strong>{(diagnostic.hitRate * 100).toFixed(1)}%</strong>
                <time>{new Date(diagnostic.createdAt).toLocaleTimeString()}</time>
                {diagnostic.missCategory && <span>{diagnostic.missCategory === 'avoidable' ? '可避免 miss' : diagnostic.missCategory === 'ttl' ? 'TTL miss' : '压缩 miss'}</span>}
              </header>
              {diagnostic.changedSections.length > 0
                ? <p>前缀变化：{diagnostic.changedSections.join('、')}</p>
                : <p>前缀稳定（{diagnostic.requestFingerprint.slice(0, 12)}）</p>}
            </article>
          ))}
          {diagnostics.length === 0 && <EmptyText>本轮会话暂无诊断记录；发送消息后逐轮生成。</EmptyText>}
        </div>
      </section>
    </div>
  )
}

function AuditPanel(): JSX.Element {
  const [rows, setRows] = useState<AuditDto[]>([])
  useEffect(() => { void window.starbit.audit.list(200).then(setRows) }, [])
  return <div className="audit-list">{rows.map((row) => <article key={row.id}><strong>{row.action}</strong><time>{new Date(row.createdAt).toLocaleString()}</time><p>{row.detail}</p></article>)}{rows.length === 0 && <EmptyText>尚无审计记录。</EmptyText>}</div>
}

function SkillsPanel(): JSX.Element {
  const workspacePath = useAppStore((state) => state.workspacePath)
  const [skills, setSkills] = useState<Array<{ name: string; description: string; scripts: string[]; scope: 'user' | 'workspace' }>>([])
  useEffect(() => {
    if (workspacePath) void window.starbit.skills.list(workspacePath).then(setSkills)
    else setSkills([])
  }, [workspacePath])
  return (
    <div className="audit-list">
      {skills.map((skill) => (
        <article key={`${skill.scope}:${skill.name}`}>
          <strong>{skill.name}</strong>
          <time>{skill.scope === 'workspace' ? '工作区技能' : '用户技能'} · {skill.scripts.length} 个脚本</time>
          <p>{skill.description}</p>
        </article>
      ))}
      {skills.length === 0 && <EmptyText>未发现可用技能。支持 .starbit/skills 与 .claude/skills。</EmptyText>}
    </div>
  )
}

function McpPanel(): JSX.Element {
  const [states, setStates] = useState<McpServerStateDto[]>([])
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [transportType, setTransportType] = useState<'stdio' | 'streamable-http' | 'sse'>('stdio')
  const [message, setMessage] = useState('')
  useEffect(() => { void window.starbit.mcp.list().then(setStates) }, [])

  const save = async (configs: McpServerConfigDto[]): Promise<void> => {
    setMessage('正在连接…')
    try {
      setStates(await window.starbit.mcp.set(configs))
      setMessage('配置已保存；工具变更将在下一会话生效。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const add = async (): Promise<void> => {
    if (!name.trim() || !endpoint.trim()) return
    const id = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || crypto.randomUUID()
    const transport = transportType === 'stdio'
      ? { type: 'stdio' as const, command: endpoint.trim(), args: [] }
      : { type: transportType, url: endpoint.trim(), ...(transportType === 'streamable-http' ? { fallbackToSse: true } : {}) }
    await save([...states.map((state) => state.config), { id, name: name.trim(), enabled: true, transport }])
    setName('')
    setEndpoint('')
  }

  const update = async (id: string, patch: Partial<McpServerConfigDto>): Promise<void> => {
    await save(states.map((state) => state.config.id === id ? { ...state.config, ...patch } : state.config))
  }

  return (
    <div className="panel-stack">
      <section className="settings-group">
        <h3>添加服务器</h3>
        <label>名称</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="filesystem" />
        <label>传输</label>
        <select value={transportType} onChange={(event) => setTransportType(event.target.value as typeof transportType)}>
          <option value="stdio">stdio</option>
          <option value="streamable-http">Streamable HTTP</option>
          <option value="sse">SSE（兼容）</option>
        </select>
        <label>{transportType === 'stdio' ? '可执行命令' : '服务 URL'}</label>
        <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={transportType === 'stdio' ? 'npx' : 'https://example.com/mcp'} />
        <button className="panel-primary-action" onClick={() => void add()}><Plus size={14} /> 添加并连接</button>
      </section>
      <div className="mcp-list">
        {states.map((state) => (
          <article className="mcp-card" key={state.config.id}>
            <div className="mcp-card__title"><strong>{state.config.name}</strong><span className={`mcp-status mcp-status--${state.status}`}>{state.status}</span></div>
            {state.error && <p className="panel-message">{state.error}</p>}
            <label className="mcp-toggle"><input type="checkbox" checked={state.config.enabled} onChange={(event) => void update(state.config.id, { enabled: event.target.checked })} /> 已启用</label>
            {state.tools.map((tool) => {
              const disabled = state.config.disabledTools?.includes(tool.name) ?? false
              return <label className="mcp-tool" key={tool.name}><input type="checkbox" checked={!disabled} onChange={(event) => {
                const next = new Set(state.config.disabledTools ?? [])
                if (event.target.checked) next.delete(tool.name); else next.add(tool.name)
                void update(state.config.id, { disabledTools: [...next] })
              }} /><span title={tool.description}>{tool.title || tool.name}</span></label>
            })}
            <button className="panel-button panel-button--danger" onClick={() => void save(states.filter((item) => item.config.id !== state.config.id).map((item) => item.config))}>移除</button>
          </article>
        ))}
      </div>
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function ComingPanel({ title }: { title: string }): JSX.Element {
  return <div className="coming-panel"><FolderOpen size={24} /><p>{title}模块将在对应里程碑中接入。</p></div>
}

function EmptyText({ children }: { children: string }): JSX.Element {
  return <p className="panel-empty">{children}</p>
}

function splitArgs(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) ?? []
}
