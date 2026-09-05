import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { MainToRendererEvent } from './types'
import { SessionManager } from '../session/manager'
import type { ModelConfig } from '@core/models'
import { AgentManager } from '../agent/manager'
import { SettingsService } from '../security/settings'
import { deleteWhitelist, listWhitelist } from '../session/database'
import { PtyHost } from '../pty/host'
import { BrowserManager } from '../browser/manager'
import type { BrowserBounds, BrowserControlMode } from '../browser/types'
import { listWorkspaceFiles, readWorkspaceFilePreview } from '../workspace/list'

const sessions = new SessionManager()
const settings = new SettingsService()
const browser = new BrowserManager({
  getHostWindow: () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null,
  settings,
  emit: pushToRenderer
})
const agents = new AgentManager(sessions, settings, pushToRenderer, browser)
const pty = new PtyHost((event) => {
  if (event.type === 'data') pushToRenderer({ type: 'terminal/data', terminalId: event.terminalId, data: event.data })
  else if (event.type === 'ready') pushToRenderer({ type: 'terminal/ready', terminalId: event.terminalId, pid: event.pid })
  else if (event.type === 'exit') pushToRenderer({ type: 'terminal/exit', terminalId: event.terminalId, exitCode: event.exitCode, signal: event.signal })
  else if (event.type === 'error') pushToRenderer({ type: 'terminal/error', terminalId: event.terminalId, message: event.message })
})

/** 主进程推送到渲染进程 */
export function pushToRenderer(event: MainToRendererEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('main:event', event)
  }
}

export function registerIpcHandlers(): void {
  // App
  ipcMain.handle('app:getInfo', () => {
    return {
      version: process.env.npm_package_version ?? '0.1.0',
      platform: process.platform,
      isDev: !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
    }
  })

  // Session
  ipcMain.handle('session:create', (_e, workspacePath: string, opts?: { title?: string; model?: string; mode?: never }) => {
    return sessions.create(workspacePath, opts)
  })
  ipcMain.handle('session:list', () => sessions.list())
  ipcMain.handle('session:get', (_e, id: string) => sessions.get(id))
  ipcMain.handle('session:update', (_e, id: string, patch: { title?: string; mode?: import('@core/events').PermissionMode; model?: string }) => sessions.update(id, patch))
  ipcMain.handle('session:replay', (_e, id: string) => sessions.replay(id))

  // Models
  ipcMain.handle('models:list', () => agents.listModels())
  ipcMain.handle('models:save', (_e, model: ModelConfig) => agents.saveModel(model))
  ipcMain.handle('models:delete', (_e, id: string) => agents.deleteModel(id))
  ipcMain.handle('models:configured', () => Object.fromEntries(agents.listModels().map((model) => [model.id, agents.isModelConfigured(model.id)])))
  ipcMain.handle('models:setApiKey', (_e, modelId: string, apiKey: string) => agents.setModelApiKey(modelId, apiKey))
  ipcMain.handle('models:testConnection', (_e, modelId: string) => agents.testModel(modelId))

  // Agent & permissions
  ipcMain.handle('agent:send', (_e, sessionId: string, content: string, attachments = [], thinkingLevel = 'max', fileRefs: string[] = []) =>
    agents.send(sessionId, content, attachments, thinkingLevel, fileRefs)
  )
  ipcMain.handle('agent:cancel', (_e, sessionId: string) => agents.cancel(sessionId))
  ipcMain.handle('agent:respondCompaction', (_e, requestId: string, accepted: boolean) => agents.respondCompaction(requestId, accepted))
  ipcMain.handle('permission:respond', (_e, requestId: string, outcome: 'allow' | 'deny', scope: import('@core/permission/rules').RuleScope, reason?: string) =>
    agents.respondPermission(requestId, outcome, scope, reason)
  )
  ipcMain.handle('permission:listRules', () => listWhitelist())
  ipcMain.handle('permission:deleteRule', (_e, id: string) => deleteWhitelist(id))
  ipcMain.handle('permission:addRule', (_e, input: { semanticLabel: string; pattern: string; action: 'allow' | 'deny' | 'ask' }) =>
    agents.addPermissionRule(input)
  )
  ipcMain.handle('permission:getSettings', () => agents.getPermissionSettings())
  ipcMain.handle('permission:setSettings', (_e, patch: { planDocPattern?: string | null }) => agents.setPermissionSettings(patch))

  // Usage, audit and settings
  ipcMain.handle('usage:summary', (_e, sessionId?: string) => agents.usageSummary(sessionId))
  ipcMain.handle('audit:list', (_e, limit?: number, sessionId?: string) => agents.audit(limit, sessionId))
  ipcMain.handle('settings:getShell', () => agents.getShell())
  ipcMain.handle('settings:setShell', (_e, shell: { executable: string; args: string[] }) => agents.setShell(shell))
  ipcMain.handle('settings:getCompaction', () => agents.getCompactionSettings())
  ipcMain.handle('settings:setCompaction', (_e, patch: { modelId?: string | null }) => agents.setCompactionSettings(patch))
  ipcMain.handle('settings:getVideo', () => agents.getVideoSettings())
  ipcMain.handle('settings:setVideo', (_e, patch: { ffmpegPath?: string }) => agents.setVideoSettings(patch))
  ipcMain.handle('skills:list', (_e, workspacePath: string) => agents.listSkills(workspacePath))
  ipcMain.handle('mcp:list', () => agents.listMcpServers())
  ipcMain.handle('mcp:set', (_e, configs: import('../mcp/types').McpServerConfig[]) => agents.setMcpServers(configs))

  // Terminal
  ipcMain.handle('terminal:create', (_e, sessionId: string, cols?: number, rows?: number) => {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在: ${sessionId}`)
    const shell = agents.getTerminalShell()
    pty.create({ terminalId: sessionId, executable: shell.executable, args: shell.args, cwd: session.workspacePath, cols, rows })
  })
  ipcMain.handle('terminal:write', (_e, sessionId: string, data: string) => pty.write(sessionId, data))
  ipcMain.handle('terminal:resize', (_e, sessionId: string, cols: number, rows: number) => pty.resize(sessionId, cols, rows))
  ipcMain.handle('terminal:close', (_e, sessionId: string) => pty.closeTerminal(sessionId))

  // Browser
  ipcMain.handle('browser:getState', (_e, sessionId: string) => {
    const session = requireSession(sessionId)
    return browser.getState(sessionId, session.workspacePath)
  })
  ipcMain.handle('browser:createTab', (_e, sessionId: string, url?: string) => {
    const session = requireSession(sessionId)
    return browser.createTab(sessionId, session.workspacePath, url)
  })
  ipcMain.handle('browser:closeTab', (_e, sessionId: string, tabId: string) => {
    const session = requireSession(sessionId)
    return browser.closeTab(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:activateTab', (_e, sessionId: string, tabId: string) => {
    const session = requireSession(sessionId)
    return browser.activateTab(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:navigate', (_e, sessionId: string, url: string, tabId?: string, newTab?: boolean) => {
    const session = requireSession(sessionId)
    return browser.navigate({ sessionId, workspacePath: session.workspacePath, url, tabId, newTab, actor: 'user' })
  })
  ipcMain.handle('browser:back', (_e, sessionId: string, tabId?: string) => {
    const session = requireSession(sessionId)
    return browser.goBack(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:forward', (_e, sessionId: string, tabId?: string) => {
    const session = requireSession(sessionId)
    return browser.goForward(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:reload', (_e, sessionId: string, tabId?: string) => {
    const session = requireSession(sessionId)
    return browser.reload(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:stop', (_e, sessionId: string, tabId?: string) => {
    const session = requireSession(sessionId)
    return browser.stop(sessionId, session.workspacePath, tabId)
  })
  ipcMain.handle('browser:setBounds', (_e, sessionId: string, bounds: BrowserBounds) => {
    const session = requireSession(sessionId)
    return browser.setBounds(sessionId, session.workspacePath, bounds)
  })
  ipcMain.handle('browser:hide', (_e, sessionId: string) => browser.hide(sessionId))
  ipcMain.handle('browser:setReuseLogin', (_e, sessionId: string, enabled: boolean) => {
    const session = requireSession(sessionId)
    return browser.setReuseLogin(sessionId, session.workspacePath, enabled)
  })
  ipcMain.handle('browser:setAllowPrivateNetwork', (_e, sessionId: string, enabled: boolean) => {
    const session = requireSession(sessionId)
    return browser.setAllowPrivateNetwork(sessionId, session.workspacePath, enabled)
  })
  ipcMain.handle('browser:setControlMode', (_e, sessionId: string, mode: BrowserControlMode) => {
    const session = requireSession(sessionId)
    return browser.setControlMode(sessionId, session.workspacePath, mode)
  })

  // Knowledge base
  ipcMain.handle('knowledge:listBases', (_e, sessionId: string) => agents.listKnowledgeBases(sessionId))
  ipcMain.handle('knowledge:createBase', (_e, sessionId: string, name: string, description?: string) => agents.createKnowledgeBase(sessionId, name, description))
  ipcMain.handle('knowledge:deleteBase', (_e, sessionId: string, id: string) => agents.deleteKnowledgeBase(sessionId, id))
  ipcMain.handle('knowledge:listDocuments', (_e, sessionId: string, knowledgeBaseId?: string) => agents.listKnowledgeDocuments(sessionId, knowledgeBaseId))
  ipcMain.handle('knowledge:selectAndImport', async (_e, sessionId: string, knowledgeBaseId: string) => {
    requireSession(sessionId)
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '支持的文档', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'pdf', 'docx'] }]
    })
    if (result.canceled) return []
    const imported = []
    for (const path of result.filePaths) imported.push(await agents.importKnowledgeDocument(sessionId, knowledgeBaseId, path))
    return imported
  })
  ipcMain.handle('knowledge:importUrl', (_e, sessionId: string, knowledgeBaseId: string, url: string) => agents.importKnowledgeUrl(sessionId, knowledgeBaseId, url))
  ipcMain.handle('knowledge:deleteDocument', (_e, sessionId: string, id: string) => agents.deleteKnowledgeDocument(sessionId, id))
  ipcMain.handle('knowledge:rebuild', (_e, sessionId: string, id: string) => agents.rebuildKnowledgeBase(sessionId, id))
  ipcMain.handle('knowledge:search', (_e, sessionId: string, query: string, knowledgeBaseId?: string) => agents.searchKnowledge(sessionId, query, knowledgeBaseId))
  ipcMain.handle('knowledge:getSettings', () => agents.getKnowledgeSettings())
  ipcMain.handle('knowledge:setSettings', (_e, value: Parameters<AgentManager['setKnowledgeSettings']>[0], apiKey?: string) => agents.setKnowledgeSettings(value, apiKey))

  // Memory
  ipcMain.handle('memory:list', (_e, sessionId: string, scope?: import('../memory/types').MemoryScope) => agents.listMemory(sessionId, scope))
  ipcMain.handle('memory:add', (_e, sessionId: string, scope: import('../memory/types').MemoryScope, content: string) => agents.addMemory(sessionId, scope, content))
  ipcMain.handle('memory:update', (_e, sessionId: string, id: string, content: string) => agents.updateMemory(sessionId, id, content))
  ipcMain.handle('memory:delete', (_e, sessionId: string, id: string) => agents.deleteMemory(sessionId, id))
  ipcMain.handle('memory:search', (_e, sessionId: string, query: string, scope?: import('../memory/types').MemoryScope) => agents.searchMemory(sessionId, query, scope))

  // Workspace
  ipcMain.handle('workspace:selectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return { path: result.filePaths[0] }
  })
  ipcMain.handle('workspace:listFiles', (_e, workspacePath: string) => listWorkspaceFiles(workspacePath))
  ipcMain.handle('workspace:readFile', (_e, workspacePath: string, path: string) => readWorkspaceFilePreview(workspacePath, path))
}

export async function shutdownIpcServices(): Promise<void> {
  pty.close()
  browser.close()
  await agents.shutdown()
}

function requireSession(sessionId: string): NonNullable<ReturnType<SessionManager['get']>> {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`会话不存在: ${sessionId}`)
  return session
}
