import { useEffect, useState } from 'react'
import { BookOpen, Brain, FileDown, FileUp, FolderOpen, HardDriveDownload, HardDriveUpload, KeyRound, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import type { AuditDto, McpServerConfigDto, McpServerStateDto, UsageReportDto } from '../../../../main/ipc/types'
import type { PermissionRule } from '@core/permission/rules'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import { KnowledgePanel } from './KnowledgePanel'
import { MemoryPanel } from './MemoryPanel'
import { ModelEditor } from './ModelEditor'
import { FilesPanel } from './FilesPanel'
import './panels.css'

const TITLE_KEYS: Record<string, string> = {
  sessions: 'panel.sessions', files: 'panel.files', kb: 'panel.kb', memory: 'panel.memory', mcp: 'panel.mcp', skills: 'panel.skills', usage: 'panel.usage', audit: 'panel.audit', settings: 'panel.settings'
}

export function SecondaryPanel(): JSX.Element {
  const { t } = useT()
  const active = useAppStore((state) => state.activeSection)
  const title = TITLE_KEYS[active] ? t(TITLE_KEYS[active]) : active
  return (
    <aside className="secondary-panel" aria-label={title}>
      <header className="secondary-panel__header">{title}</header>
      <div className="secondary-panel__body">
        {active === 'sessions' ? <SessionsPanel /> : active === 'settings' ? <SettingsPanel /> : active === 'usage' ? <UsagePanel /> : active === 'audit' ? <AuditPanel /> : active === 'skills' ? <SkillsPanel /> : active === 'mcp' ? <McpPanel /> : active === 'kb' ? <KnowledgePanel /> : active === 'memory' ? <MemoryPanel /> : active === 'files' ? <FilesPanel /> : <ComingPanel title={title} />}
      </div>
    </aside>
  )
}

function SessionsPanel(): JSX.Element {
  const { t } = useT()
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
      <button className="panel-primary-action" onClick={() => void createSession()}><Plus size={16} /> {t('sessions.new')}</button>
      <div className="session-list">
        {sessions.map((session) => (
          <button key={session.id} className={`session-item ${currentSessionId === session.id ? 'is-active' : ''}`} onClick={() => void selectSession(session.id)}>
            <span className="session-item__title">{session.title}</span>
            <span className="session-item__path">{session.workspacePath}</span>
          </button>
        ))}
        {sessions.length === 0 && <EmptyText>{t('sessions.empty')}</EmptyText>}
      </div>
    </div>
  )
}

function SettingsPanel(): JSX.Element {
  const { t, language, setLanguage } = useT()
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
    setMessage(t('settings.keySaved'))
  }

  const test = async (): Promise<void> => {
    setMessage(t('settings.testing'))
    const result = await window.starbit.models.testConnection(currentModel)
    setMessage(result.ok ? t('settings.testOk', { ms: result.latencyMs }) : result.message)
  }

  const saveShell = async (): Promise<void> => {
    await window.starbit.settings.setShell({ executable: shellExecutable, args: splitArgs(shellArgs) })
    setMessage(t('settings.shellSaved'))
  }

  const saveCompaction = async (): Promise<void> => {
    try {
      await window.starbit.settings.setCompaction({ modelId: compactionModelId || null })
      setMessage(t('settings.compactionSaved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const saveVideo = async (): Promise<void> => {
    await window.starbit.settings.setVideo({ ffmpegPath })
    setMessage(t('settings.videoSaved'))
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
    setMessage(t('settings.embeddingSaved'))
  }

  const deleteRule = async (id: string): Promise<void> => {
    await window.starbit.permission.deleteRule(id)
    setRules(await window.starbit.permission.listRules())
    setMessage(t('settings.ruleDeleted'))
  }

  const addRule = async (): Promise<void> => {
    try {
      await window.starbit.permission.addRule({ semanticLabel: ruleLabel, pattern: rulePattern, action: ruleAction })
      setRules(await window.starbit.permission.listRules())
      setRulePattern('')
      setMessage(t('settings.ruleAdded'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const savePlanDocPattern = async (): Promise<void> => {
    try {
      await window.starbit.permission.setSettings({ planDocPattern: planDocPattern.trim() || null })
      setMessage(t('settings.planDocSaved'))
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
    setMessage(t('settings.browserSaved'))
  }

  const exportSession = async (format: 'markdown' | 'json'): Promise<void> => {
    if (!currentSessionId) return
    const result = await window.starbit.session.export(currentSessionId, format)
    setMessage(result ? t('settings.dataExported', { path: result.path }) : t('settings.exportCancelled'))
  }

  const importSession = async (): Promise<void> => {
    try {
      const session = await window.starbit.session.import(useAppStore.getState().workspacePath)
      if (session) {
        const state = useAppStore.getState()
        state.setSessions([session, ...state.sessions])
        setMessage(t('settings.sessionImported', { title: session.title }))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const exportData = async (): Promise<void> => {
    const result = await window.starbit.data.export()
    setMessage(result ? t('settings.dataExported', { path: result.path }) : t('settings.exportCancelled'))
  }

  const importData = async (): Promise<void> => {
    if (!window.confirm(t('settings.importConfirm'))) return
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
      setMessage(t('settings.dataImported'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="panel-stack">
      <section className="settings-group">
        <h3>{t('settings.model')}</h3>
        <label>{t('settings.modelLabel')}</label>
        <select value={currentModel} onChange={(event) => useAppStore.getState().setModel(event.target.value)}>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <label>{t('settings.apiKey', { state: configured[currentModel] ? t('settings.apiKeyConfigured') : t('settings.apiKeyMissing') })}</label>
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('settings.apiKeyPlaceholder')} />
        <div className="panel-actions">
          <button className="panel-button" onClick={() => void saveKey()}><KeyRound size={14} /> {t('settings.saveKey')}</button>
          <button className="panel-button" onClick={() => void test()}><RefreshCw size={14} /> {t('settings.testConnection')}</button>
        </div>
      </section>
      <section className="settings-group">
        <h3>{t('settings.shell')}</h3>
        <label>{t('settings.shellExecutable')}</label>
        <input value={shellExecutable} onChange={(event) => setShellExecutable(event.target.value)} />
        <label>{t('settings.shellArgs')}</label>
        <input value={shellArgs} onChange={(event) => setShellArgs(event.target.value)} />
        <button className="panel-button" onClick={() => void saveShell()}><Save size={14} /> {t('settings.saveShell')}</button>
      </section>
      <section className="settings-group">
        <h3>{t('settings.compaction')}</h3>
        <label>{t('settings.compactionModel')}</label>
        <select value={compactionModelId} onChange={(event) => setCompactionModelId(event.target.value)}>
          <option value="">{t('settings.compactionFollow')}</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <button className="panel-button" onClick={() => void saveCompaction()}><Save size={14} /> {t('settings.saveCompaction')}</button>
        <label>{t('settings.ffmpegPath')}</label>
        <input value={ffmpegPath} onChange={(event) => setFfmpegPath(event.target.value)} placeholder="ffmpeg" />
        <button className="panel-button" onClick={() => void saveVideo()}><Save size={14} /> {t('settings.saveVideo')}</button>
      </section>
      <ModelEditor />
      <section className="settings-group">
        <h3><ShieldCheck size={15} /> {t('settings.whitelist')}</h3>
        <div className="settings-rule-list">
          {rules.map((rule) => <article key={rule.id}><div><strong>{rule.semanticLabel}({rule.pattern})</strong><span>{rule.action} · {rule.scope} · 命中 {rule.hitCount ?? 0} 次</span></div><button title="删除规则" onClick={() => void deleteRule(rule.id)}><Trash2 size={13} /></button></article>)}
          {rules.length === 0 && <EmptyText>{t('settings.noRules')}</EmptyText>}
        </div>
        <div className="settings-rule-editor">
          <label>{t('settings.ruleLabel')}</label>
          <input value={ruleLabel} onChange={(event) => setRuleLabel(event.target.value)} placeholder="Bash / Write / Edit" />
          <label>{t('settings.rulePattern')}</label>
          <input value={rulePattern} onChange={(event) => setRulePattern(event.target.value)} placeholder="npm run * 或 ./docs/**" />
          <label>{t('settings.ruleAction')}</label>
          <select value={ruleAction} onChange={(event) => setRuleAction(event.target.value as typeof ruleAction)}>
            <option value="allow">{t('settings.actionAllow')}</option>
            <option value="ask">{t('settings.actionAsk')}</option>
            <option value="deny">{t('settings.actionDeny')}</option>
          </select>
          <button className="panel-button" onClick={() => void addRule()}><Plus size={14} /> {t('settings.addRule')}</button>
        </div>
        <label>{t('settings.planDocPattern')}</label>
        <input value={planDocPattern} onChange={(event) => setPlanDocPattern(event.target.value)} placeholder={t('settings.planDocPlaceholder')} />
        <button className="panel-button" onClick={() => void savePlanDocPattern()}><Save size={14} /> {t('settings.savePlanDoc')}</button>
      </section>
      <section className="settings-group">
        <h3><BookOpen size={15} /> {t('settings.embedding')}</h3>
        <label>{t('settings.embeddingMode')}</label>
        <select value={embeddingMode} onChange={(event) => setEmbeddingMode(event.target.value as typeof embeddingMode)}>
          <option value="local">{t('settings.embeddingLocal')}</option>
          <option value="auto">{t('settings.embeddingAuto')}</option>
          <option value="remote">{t('settings.embeddingRemote')}</option>
        </select>
        {embeddingMode !== 'local' && <>
          <label>{t('settings.embeddingBaseUrl')}</label>
          <input value={embeddingBaseUrl} onChange={(event) => setEmbeddingBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
          <label>{t('settings.embeddingModel')}</label>
          <input value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} placeholder="text-embedding-model" />
          <label>API Key {embeddingKeyConfigured ? '（已配置）' : '（未配置）'}</label>
          <input type="password" autoComplete="off" value={embeddingApiKey} onChange={(event) => setEmbeddingApiKey(event.target.value)} placeholder="留空则保留现有密钥" />
        </>}
        <label>{t('settings.embeddingDimensions')}</label>
        <input type="number" min={16} max={8192} value={embeddingDimensions} onChange={(event) => setEmbeddingDimensions(Number(event.target.value))} />
        <button className="panel-button" onClick={() => void saveEmbedding()}><Save size={14} /> {t('settings.saveEmbedding')}</button>
      </section>
      <section className="settings-group">
        <h3>{t('settings.browserSecurity')}</h3>
        {currentSessionId ? <>
          <label className="panel-checkbox"><input type="checkbox" checked={reuseLogin} onChange={(event) => void updateBrowserSetting('reuse', event.target.checked)} /> {t('settings.reuseLogin')}</label>
          <label className="panel-checkbox"><input type="checkbox" checked={allowPrivateNetwork} onChange={(event) => void updateBrowserSetting('private', event.target.checked)} /> {t('settings.privateNetwork')}</label>
        </> : <EmptyText>{t('settings.selectSessionFirst')}</EmptyText>}
      </section>
      <section className="settings-group">
        <h3><Brain size={15} /> {t('settings.memory')}</h3>
        <p className="panel-message">{t('settings.memoryNote')}</p>
        <button className="panel-button" onClick={() => useAppStore.getState().setActiveSection('memory')}>{t('settings.openMemory')}</button>
      </section>
      <section className="settings-group">
        <h3>{t('settings.language')}</h3>
        <select value={language} onChange={(event) => setLanguage(event.target.value as 'zh-CN' | 'en-US')}>
          <option value="zh-CN">中文（简体）</option>
          <option value="en-US">English</option>
        </select>
      </section>
      <section className="settings-group">
        <h3>{t('settings.data')}</h3>
        <div className="panel-actions">
          <button className="panel-button" disabled={!currentSessionId} onClick={() => void exportSession('markdown')}><FileDown size={14} /> {t('settings.exportSessionMd')}</button>
          <button className="panel-button" disabled={!currentSessionId} onClick={() => void exportSession('json')}><FileDown size={14} /> {t('settings.exportSessionJson')}</button>
          <button className="panel-button" onClick={() => void importSession()}><FileUp size={14} /> {t('settings.importSession')}</button>
        </div>
        <div className="panel-actions">
          <button className="panel-button" onClick={() => void exportData()}><HardDriveDownload size={14} /> {t('settings.exportAll')}</button>
          <button className="panel-button panel-button--danger" onClick={() => void importData()}><HardDriveUpload size={14} /> {t('settings.importAll')}</button>
        </div>
        <p className="panel-message">{t('settings.dataNote')}</p>
      </section>
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function UsagePanel(): JSX.Element {
  const { t } = useT()
  const [summary, setSummary] = useState<UsageReportDto | null>(null)
  const diagnostics = useAppStore((state) => state.cacheDiagnostics)
  const currentSessionId = useAppStore((state) => state.currentSessionId)
  const [scopeAll, setScopeAll] = useState(true)
  useEffect(() => {
    void window.starbit.usage.summary(scopeAll ? undefined : currentSessionId ?? undefined).then(setSummary)
  }, [scopeAll, currentSessionId])
  if (!summary) return <EmptyText>{t('usage.loading')}</EmptyText>
  const items = [
    [t('usage.totalInput'), summary.promptTokens], [t('usage.cached'), summary.cachedTokens], [t('usage.uncached'), summary.uncachedTokens], [t('usage.output'), summary.outputTokens]
  ] as const
  return (
    <div className="panel-stack">
      <div className="usage-rate"><strong>{(summary.hitRate * 100).toFixed(1)}%</strong><span>{t('usage.globalRate', { scope: scopeAll ? t('usage.scopeAll') : t('usage.scopeSession') })}</span></div>
      <div className="usage-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
      <p className="usage-misses">{t('usage.missBadges', { avoidable: summary.avoidableMisses, ttl: summary.ttlMisses, compaction: summary.compactionMisses })}</p>
      <div className="usage-scope-toggle">
        <button className={`panel-button ${scopeAll ? 'is-active' : ''}`} onClick={() => setScopeAll(true)}>{t('usage.scopeAll')}</button>
        <button className={`panel-button ${!scopeAll ? 'is-active' : ''}`} disabled={!currentSessionId} onClick={() => setScopeAll(false)}>{t('usage.scopeSession')}</button>
      </div>
      <section className="settings-group">
        <h3>{t('usage.perModel')}</h3>
        <div className="usage-cost-table">
          {summary.byModel.map((row) => (
            <article key={row.model}>
              <strong>{row.model}</strong>
              <span>{t('usage.modelDetail', { prompt: row.promptTokens.toLocaleString(), cached: row.cachedTokens.toLocaleString(), output: row.outputTokens.toLocaleString(), requests: row.requests })}</span>
              <em>{row.estimatedCost === null ? t('usage.noPrice') : `¥${row.estimatedCost.toFixed(4)}`}</em>
            </article>
          ))}
          {summary.byModel.length === 0 && <EmptyText>{t('usage.noUsage')}</EmptyText>}
        </div>
        <p className="panel-message">
          {t('usage.totalCost', { cost: summary.totalEstimatedCost.toFixed(4), suffix: summary.pricingConfigured ? t('usage.costNote') : t('usage.costPartial') })}
        </p>
      </section>
      <section className="settings-group">
        <h3>{t('usage.subagent')}</h3>
        <p className="panel-message">
          {t('usage.modelDetail', { prompt: summary.subagent.promptTokens.toLocaleString(), cached: summary.subagent.cachedTokens.toLocaleString(), output: summary.subagent.outputTokens.toLocaleString(), requests: summary.subagent.requests })} · ¥{summary.subagent.estimatedCost.toFixed(4)}
        </p>
        <p className="panel-message">{t('usage.subagentNote')}</p>
      </section>
      <section className="settings-group">
        <h3>{t('usage.diagnostics')}</h3>
        <div className="cache-diagnostic-list">
          {diagnostics.map((diagnostic, index) => (
            <article key={`${diagnostic.requestFingerprint}-${index}`} className={diagnostic.changedSections.length > 0 ? 'is-changed' : ''}>
              <header>
                <strong>{(diagnostic.hitRate * 100).toFixed(1)}%</strong>
                <time>{new Date(diagnostic.createdAt).toLocaleTimeString()}</time>
                {diagnostic.missCategory && <span>{t(`usage.miss${diagnostic.missCategory === 'avoidable' ? 'Avoidable' : diagnostic.missCategory === 'ttl' ? 'Ttl' : 'Compaction'}`)}</span>}
              </header>
              {diagnostic.changedSections.length > 0
                ? <p>{t('usage.prefixChanged', { sections: diagnostic.changedSections.join(', ') })}</p>
                : <p>{t('usage.prefixStable', { fingerprint: diagnostic.requestFingerprint.slice(0, 12) })}</p>}
            </article>
          ))}
          {diagnostics.length === 0 && <EmptyText>{t('usage.noDiagnostics')}</EmptyText>}
        </div>
      </section>
    </div>
  )
}

function AuditPanel(): JSX.Element {
  const { t } = useT()
  const [rows, setRows] = useState<AuditDto[]>([])
  useEffect(() => { void window.starbit.audit.list(200).then(setRows) }, [])
  return <div className="audit-list">{rows.map((row) => <article key={row.id}><strong>{row.action}</strong><time>{new Date(row.createdAt).toLocaleString()}</time><p>{row.detail}</p></article>)}{rows.length === 0 && <EmptyText>{t('audit.empty')}</EmptyText>}</div>
}

function SkillsPanel(): JSX.Element {
  const { t } = useT()
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
          <time>{skill.scope === 'workspace' ? t('skills.workspaceSkill') : t('skills.userSkill')} · {t('skills.scriptCount', { count: skill.scripts.length })}</time>
          <p>{skill.description}</p>
        </article>
      ))}
      {skills.length === 0 && <EmptyText>{t('skills.empty')}</EmptyText>}
    </div>
  )
}

function McpPanel(): JSX.Element {
  const { t } = useT()
  const [states, setStates] = useState<McpServerStateDto[]>([])
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [transportType, setTransportType] = useState<'stdio' | 'streamable-http' | 'sse'>('stdio')
  const [message, setMessage] = useState('')
  useEffect(() => { void window.starbit.mcp.list().then(setStates) }, [])

  const save = async (configs: McpServerConfigDto[]): Promise<void> => {
    setMessage(t('mcp.saving'))
    try {
      setStates(await window.starbit.mcp.set(configs))
      setMessage(t('mcp.saved'))
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
        <h3>{t('mcp.addServer')}</h3>
        <label>{t('mcp.name')}</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="filesystem" />
        <label>{t('mcp.transport')}</label>
        <select value={transportType} onChange={(event) => setTransportType(event.target.value as typeof transportType)}>
          <option value="stdio">stdio</option>
          <option value="streamable-http">Streamable HTTP</option>
          <option value="sse">SSE（兼容）</option>
        </select>
        <label>{transportType === 'stdio' ? t('mcp.endpointCommand') : t('mcp.endpointUrl')}</label>
        <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={transportType === 'stdio' ? 'npx' : 'https://example.com/mcp'} />
        <button className="panel-primary-action" onClick={() => void add()}><Plus size={14} /> {t('mcp.addAndConnect')}</button>
      </section>
      <div className="mcp-list">
        {states.map((state) => (
          <article className="mcp-card" key={state.config.id}>
            <div className="mcp-card__title"><strong>{state.config.name}</strong><span className={`mcp-status mcp-status--${state.status}`}>{state.status}</span></div>
            {state.error && <p className="panel-message">{state.error}</p>}
            <label className="mcp-toggle"><input type="checkbox" checked={state.config.enabled} onChange={(event) => void update(state.config.id, { enabled: event.target.checked })} /> {t('mcp.enabled')}</label>
            {state.tools.map((tool) => {
              const disabled = state.config.disabledTools?.includes(tool.name) ?? false
              return <label className="mcp-tool" key={tool.name}><input type="checkbox" checked={!disabled} onChange={(event) => {
                const next = new Set(state.config.disabledTools ?? [])
                if (event.target.checked) next.delete(tool.name); else next.add(tool.name)
                void update(state.config.id, { disabledTools: [...next] })
              }} /><span title={tool.description}>{tool.title || tool.name}</span></label>
            })}
            <button className="panel-button panel-button--danger" onClick={() => void save(states.filter((item) => item.config.id !== state.config.id).map((item) => item.config))}>{t('mcp.remove')}</button>
          </article>
        ))}
      </div>
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function ComingPanel({ title }: { title: string }): JSX.Element {
  return <div className="coming-panel"><FolderOpen size={24} /><p>{title}</p></div>
}

function EmptyText({ children }: { children: string }): JSX.Element {
  return <p className="panel-empty">{children}</p>
}

function splitArgs(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) ?? []
}
