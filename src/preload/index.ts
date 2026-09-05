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
    save: (model) => ipcRenderer.invoke('models:save', model),
    delete: (id) => ipcRenderer.invoke('models:delete', id),
    configured: () => ipcRenderer.invoke('models:configured'),
    setApiKey: (modelId, apiKey) => ipcRenderer.invoke('models:setApiKey', modelId, apiKey),
    testConnection: (modelId) => ipcRenderer.invoke('models:testConnection', modelId)
  },
  agent: {
    send: (sessionId, content, attachments, thinkingLevel, fileRefs) => ipcRenderer.invoke('agent:send', sessionId, content, attachments, thinkingLevel, fileRefs),
    cancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId),
    respondCompaction: (requestId, accepted) => ipcRenderer.invoke('agent:respondCompaction', requestId, accepted)
  },
  permission: {
    respond: (requestId, outcome, scope, reason) => ipcRenderer.invoke('permission:respond', requestId, outcome, scope, reason),
    listRules: () => ipcRenderer.invoke('permission:listRules'),
    deleteRule: (id) => ipcRenderer.invoke('permission:deleteRule', id),
    addRule: (input) => ipcRenderer.invoke('permission:addRule', input),
    getSettings: () => ipcRenderer.invoke('permission:getSettings'),
    setSettings: (patch) => ipcRenderer.invoke('permission:setSettings', patch)
  },
  usage: {
    summary: (sessionId) => ipcRenderer.invoke('usage:summary', sessionId)
  },
  audit: {
    list: (limit, sessionId) => ipcRenderer.invoke('audit:list', limit, sessionId)
  },
  settings: {
    getShell: () => ipcRenderer.invoke('settings:getShell'),
    setShell: (shell) => ipcRenderer.invoke('settings:setShell', shell),
    getCompaction: () => ipcRenderer.invoke('settings:getCompaction'),
    setCompaction: (patch) => ipcRenderer.invoke('settings:setCompaction', patch),
    getVideo: () => ipcRenderer.invoke('settings:getVideo'),
    setVideo: (patch) => ipcRenderer.invoke('settings:setVideo', patch)
  },
  skills: {
    list: (workspacePath) => ipcRenderer.invoke('skills:list', workspacePath)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    set: (configs) => ipcRenderer.invoke('mcp:set', configs)
  },
  terminal: {
    create: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:create', sessionId, cols, rows),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    close: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId)
  },
  browser: {
    getState: (sessionId) => ipcRenderer.invoke('browser:getState', sessionId),
    createTab: (sessionId, url) => ipcRenderer.invoke('browser:createTab', sessionId, url),
    closeTab: (sessionId, tabId) => ipcRenderer.invoke('browser:closeTab', sessionId, tabId),
    activateTab: (sessionId, tabId) => ipcRenderer.invoke('browser:activateTab', sessionId, tabId),
    navigate: (sessionId, url, tabId, newTab) => ipcRenderer.invoke('browser:navigate', sessionId, url, tabId, newTab),
    back: (sessionId, tabId) => ipcRenderer.invoke('browser:back', sessionId, tabId),
    forward: (sessionId, tabId) => ipcRenderer.invoke('browser:forward', sessionId, tabId),
    reload: (sessionId, tabId) => ipcRenderer.invoke('browser:reload', sessionId, tabId),
    stop: (sessionId, tabId) => ipcRenderer.invoke('browser:stop', sessionId, tabId),
    setBounds: (sessionId, bounds) => ipcRenderer.invoke('browser:setBounds', sessionId, bounds),
    hide: (sessionId) => ipcRenderer.invoke('browser:hide', sessionId),
    setReuseLogin: (sessionId, enabled) => ipcRenderer.invoke('browser:setReuseLogin', sessionId, enabled),
    setAllowPrivateNetwork: (sessionId, enabled) => ipcRenderer.invoke('browser:setAllowPrivateNetwork', sessionId, enabled),
    setControlMode: (sessionId, mode) => ipcRenderer.invoke('browser:setControlMode', sessionId, mode)
  },
  knowledge: {
    listBases: (sessionId) => ipcRenderer.invoke('knowledge:listBases', sessionId),
    createBase: (sessionId, name, description) => ipcRenderer.invoke('knowledge:createBase', sessionId, name, description),
    deleteBase: (sessionId, id) => ipcRenderer.invoke('knowledge:deleteBase', sessionId, id),
    listDocuments: (sessionId, knowledgeBaseId) => ipcRenderer.invoke('knowledge:listDocuments', sessionId, knowledgeBaseId),
    selectAndImport: (sessionId, knowledgeBaseId) => ipcRenderer.invoke('knowledge:selectAndImport', sessionId, knowledgeBaseId),
    importUrl: (sessionId, knowledgeBaseId, url) => ipcRenderer.invoke('knowledge:importUrl', sessionId, knowledgeBaseId, url),
    deleteDocument: (sessionId, id) => ipcRenderer.invoke('knowledge:deleteDocument', sessionId, id),
    rebuild: (sessionId, knowledgeBaseId) => ipcRenderer.invoke('knowledge:rebuild', sessionId, knowledgeBaseId),
    search: (sessionId, query, knowledgeBaseId) => ipcRenderer.invoke('knowledge:search', sessionId, query, knowledgeBaseId),
    getSettings: () => ipcRenderer.invoke('knowledge:getSettings'),
    setSettings: (value, apiKey) => ipcRenderer.invoke('knowledge:setSettings', value, apiKey)
  },
  memory: {
    list: (sessionId, scope) => ipcRenderer.invoke('memory:list', sessionId, scope),
    add: (sessionId, scope, content) => ipcRenderer.invoke('memory:add', sessionId, scope, content),
    update: (sessionId, id, content) => ipcRenderer.invoke('memory:update', sessionId, id, content),
    delete: (sessionId, id) => ipcRenderer.invoke('memory:delete', sessionId, id),
    search: (sessionId, query, scope) => ipcRenderer.invoke('memory:search', sessionId, query, scope)
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke('workspace:selectFolder'),
    listFiles: (workspacePath) => ipcRenderer.invoke('workspace:listFiles', workspacePath),
    readFile: (workspacePath, path) => ipcRenderer.invoke('workspace:readFile', workspacePath, path)
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
