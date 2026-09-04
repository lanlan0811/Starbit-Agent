import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { MainToRendererEvent } from './types'
import { SessionManager } from '../session/manager'
import { BUILTIN_MODELS } from '@core/models'
import { AgentManager } from '../agent/manager'
import { SettingsService } from '../security/settings'
import { deleteWhitelist, listWhitelist } from '../session/database'

const sessions = new SessionManager()
const settings = new SettingsService()
const agents = new AgentManager(sessions, settings, pushToRenderer)

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
  ipcMain.handle('models:list', () => BUILTIN_MODELS)
  ipcMain.handle('models:configured', () => Object.fromEntries(BUILTIN_MODELS.map((model) => [model.id, agents.isModelConfigured(model.id)])))
  ipcMain.handle('models:setApiKey', (_e, modelId: string, apiKey: string) => agents.setModelApiKey(modelId, apiKey))
  ipcMain.handle('models:testConnection', (_e, modelId: string) => agents.testModel(modelId))

  // Agent & permissions
  ipcMain.handle('agent:send', (_e, sessionId: string, content: string, attachments = [], thinkingLevel = 'max') =>
    agents.send(sessionId, content, attachments, thinkingLevel)
  )
  ipcMain.handle('agent:cancel', (_e, sessionId: string) => agents.cancel(sessionId))
  ipcMain.handle('permission:respond', (_e, requestId: string, outcome: 'allow' | 'deny', scope: import('@core/permission/rules').RuleScope, reason?: string) =>
    agents.respondPermission(requestId, outcome, scope, reason)
  )
  ipcMain.handle('permission:listRules', () => listWhitelist())
  ipcMain.handle('permission:deleteRule', (_e, id: string) => deleteWhitelist(id))

  // Usage, audit and settings
  ipcMain.handle('usage:summary', (_e, sessionId?: string) => agents.usageSummary(sessionId))
  ipcMain.handle('audit:list', (_e, limit?: number, sessionId?: string) => agents.audit(limit, sessionId))
  ipcMain.handle('settings:getShell', () => agents.getShell())
  ipcMain.handle('settings:setShell', (_e, shell: { executable: string; args: string[] }) => agents.setShell(shell))
  ipcMain.handle('skills:list', (_e, workspacePath: string) => agents.listSkills(workspacePath))

  // Workspace
  ipcMain.handle('workspace:selectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return { path: result.filePaths[0] }
  })
}
