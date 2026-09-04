import { useEffect, useState } from 'react'
import { FolderOpen, KeyRound, Plus, RefreshCw, Save } from 'lucide-react'
import type { AuditDto, McpServerConfigDto, McpServerStateDto, UsageSummaryDto } from '../../../../main/ipc/types'
import { useAppStore } from '../../stores/app'
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
        {active === 'sessions' ? <SessionsPanel /> : active === 'settings' ? <SettingsPanel /> : active === 'usage' ? <UsagePanel /> : active === 'audit' ? <AuditPanel /> : active === 'skills' ? <SkillsPanel /> : active === 'mcp' ? <McpPanel /> : <ComingPanel title={TITLES[active] ?? active} />}
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
  const [apiKey, setApiKey] = useState('')
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [shellExecutable, setShellExecutable] = useState('')
  const [shellArgs, setShellArgs] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void Promise.all([window.starbit.models.configured(), window.starbit.settings.getShell()]).then(([keys, shell]) => {
      setConfigured(keys)
      setShellExecutable(shell.executable)
      setShellArgs(shell.args.join(' '))
    })
  }, [])

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
      {message && <p className="panel-message" role="status">{message}</p>}
    </div>
  )
}

function UsagePanel(): JSX.Element {
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null)
  useEffect(() => { void window.starbit.usage.summary().then(setSummary) }, [])
  if (!summary) return <EmptyText>正在读取用量…</EmptyText>
  const items = [
    ['总输入', summary.promptTokens], ['缓存命中', summary.cachedTokens], ['未命中', summary.uncachedTokens], ['输出', summary.outputTokens]
  ] as const
  return (
    <div className="panel-stack">
      <div className="usage-rate"><strong>{(summary.hitRate * 100).toFixed(1)}%</strong><span>全局缓存命中率</span></div>
      <div className="usage-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
      <p className="usage-misses">可避免 {summary.avoidableMisses} · TTL {summary.ttlMisses} · 压缩 {summary.compactionMisses}</p>
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
