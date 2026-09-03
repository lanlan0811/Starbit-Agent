import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { MainToRendererEvent } from './types'
import { SessionManager } from '../session/manager'
import { BUILTIN_MODELS } from '@core/models'

const sessions = new SessionManager()

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
