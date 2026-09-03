import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, MainToRendererEvent } from '../main/ipc/types'

const api: IpcApi = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  session: {
    create: (workspacePath, opts) => ipcRenderer.invoke('session:create', workspacePath, opts),
    list: () => ipcRenderer.invoke('session:list'),
    get: (id) => ipcRenderer.invoke('session:get', id),
    update: (id, patch) => ipcRenderer.invoke('session:update', id, patch),
    replay: (id) => ipcRenderer.invoke('session:replay', id)
  },
  models: {
    list: () => ipcRenderer.invoke('models:list')
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke('workspace:selectFolder')
  }
}

/** 订阅主进程事件 */
function onMainEvent(cb: (event: MainToRendererEvent) => void): () => void {
  const listener = (_e: unknown, payload: MainToRendererEvent): void => cb(payload)
  ipcRenderer.on('main:event', listener)
  return () => ipcRenderer.removeListener('main:event', listener)
}

contextBridge.exposeInMainWorld('starbit', api)
contextBridge.exposeInMainWorld('onStarbitEvent', onMainEvent)
