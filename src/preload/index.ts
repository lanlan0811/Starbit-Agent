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
    list: () => ipcRenderer.invoke('models:list'),
    configured: () => ipcRenderer.invoke('models:configured'),
    setApiKey: (modelId, apiKey) => ipcRenderer.invoke('models:setApiKey', modelId, apiKey),
    testConnection: (modelId) => ipcRenderer.invoke('models:testConnection', modelId)
  },
  agent: {
    send: (sessionId, content, attachments, thinkingLevel) => ipcRenderer.invoke('agent:send', sessionId, content, attachments, thinkingLevel),
    cancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId)
  },
  permission: {
    respond: (requestId, outcome, scope, reason) => ipcRenderer.invoke('permission:respond', requestId, outcome, scope, reason),
    listRules: () => ipcRenderer.invoke('permission:listRules'),
    deleteRule: (id) => ipcRenderer.invoke('permission:deleteRule', id)
  },
  usage: {
    summary: (sessionId) => ipcRenderer.invoke('usage:summary', sessionId)
  },
  audit: {
    list: (limit, sessionId) => ipcRenderer.invoke('audit:list', limit, sessionId)
  },
  settings: {
    getShell: () => ipcRenderer.invoke('settings:getShell'),
    setShell: (shell) => ipcRenderer.invoke('settings:setShell', shell)
  },
  skills: {
    list: (workspacePath) => ipcRenderer.invoke('skills:list', workspacePath)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    set: (configs) => ipcRenderer.invoke('mcp:set', configs)
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
