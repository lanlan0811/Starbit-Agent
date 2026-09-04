import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import {
  BrowserWindow,
  WebContentsView,
  nativeImage,
  session as electronSession,
  type DownloadItem,
  type Rectangle,
  type Session,
  type WebContents
} from 'electron'
import { nanoid } from '@core/nanoid'
import type { SettingsService } from '../security/settings'
import { resolveAuthorizedPath } from '../tools/workspace'
import { domSnapshotToMarkdown, type DomSnapshotPayload } from './snapshot'
import { isPrivateNetworkUrl, normalizeBrowserUrl } from './security'
import type {
  BrowserAutomation,
  BrowserBounds,
  BrowserClickOptions,
  BrowserControlMode,
  BrowserDownloadOptions,
  BrowserDownloadState,
  BrowserManagerEvent,
  BrowserNavigateOptions,
  BrowserScreenshotOptions,
  BrowserScrollOptions,
  BrowserSnapshotOptions,
  BrowserState,
  BrowserTabState,
  BrowserTypeOptions,
  BrowserUploadOptions
} from './types'

const DEFAULT_SEARCH_URL_TEMPLATE = 'https://www.bing.com/search?q={query}'
const MAX_BROWSER_TABS = 12
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_SCREENSHOT_DIMENSION = 8_192
const HIGHLIGHT_DURATION_MS = 220
const INTERNAL_BLANK_URL = 'about:blank'

interface BrowserManagerOptions {
  getHostWindow: () => BrowserWindow | null
  settings: SettingsService
  emit: (event: BrowserManagerEvent) => void
  maxTabs?: number
  downloadTimeoutMs?: number
  maxScreenshotDimension?: number
}

interface BrowserTab {
  id: string
  view: WebContentsView
  title: string
  url: string
  loading: boolean
}

interface BrowserWorkspace {
  sessionId: string
  workspacePath: string
  partition: string
  session: Session
  reuseLogin: boolean
  allowPrivateNetwork: boolean
  controlMode: BrowserControlMode
  activeTabId: string | null
  tabs: Map<string, BrowserTab>
  downloadListener: (event: Electron.Event, item: DownloadItem, webContents: WebContents) => void
}

interface PendingDownload {
  sessionId: string
  tabId: string
  sourceUrl: string
  targetPath: string
  resolve: (result: { tabId: string; url: string; path: string; bytes: number }) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  item?: DownloadItem
  abort: () => void
}

interface CdpNode {
  nodeId: number
  x: number
  y: number
}

/**
 * 可视化浏览器宿主。每个 Starbit 会话拥有独立 Chromium partition；只有用户显式开启后才使用 persist 分区。
 */
export class BrowserManager implements BrowserAutomation {
  private readonly workspaces = new Map<string, BrowserWorkspace>()
  private readonly pendingDownloads = new Map<number, PendingDownload>()
  private readonly instanceNonce = nanoid('browser-process')
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0, visible: false }
  private visibleSessionId: string | null = null
  private boundHostId: number | null = null

  constructor(private readonly options: BrowserManagerOptions) {}

  getState(sessionId: string, workspacePath: string): BrowserState {
    return this.stateOf(this.ensureWorkspace(sessionId, workspacePath))
  }

  async createTab(sessionId: string, workspacePath: string, url?: string, activate = true): Promise<BrowserTabState> {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    if (workspace.tabs.size >= (this.options.maxTabs ?? MAX_BROWSER_TABS)) throw new Error('浏览器标签页数量已达上限')
    const view = new WebContentsView({
      webPreferences: {
        partition: workspace.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true
      }
    })
    const tab: BrowserTab = { id: nanoid('browser-tab'), view, title: '新标签页', url: '', loading: false }
    workspace.tabs.set(tab.id, tab)
    this.configureTab(workspace, tab)
    this.addViewToHost(view)
    view.setVisible(false)
    if (activate || !workspace.activeTabId) workspace.activeTabId = tab.id
    if (this.visibleSessionId === sessionId) this.applyVisibility()
    this.emitState(workspace)
    if (url) await this.navigate({ sessionId, workspacePath, tabId: tab.id, url, actor: 'user' })
    return this.tabState(tab)
  }

  closeTab(sessionId: string, workspacePath: string, tabId: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    const tab = this.requireTab(workspace, tabId)
    const ids = [...workspace.tabs.keys()]
    const index = ids.indexOf(tab.id)
    this.destroyTab(tab)
    workspace.tabs.delete(tab.id)
    if (workspace.activeTabId === tab.id) {
      workspace.activeTabId = ids[index + 1] && workspace.tabs.has(ids[index + 1])
        ? ids[index + 1]
        : ids[index - 1] && workspace.tabs.has(ids[index - 1])
          ? ids[index - 1]
          : workspace.tabs.keys().next().value ?? null
    }
    this.applyVisibility()
    this.emitState(workspace)
    return this.stateOf(workspace)
  }

  activateTab(sessionId: string, workspacePath: string, tabId: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    this.requireTab(workspace, tabId)
    workspace.activeTabId = tabId
    this.visibleSessionId = sessionId
    this.applyVisibility()
    this.emitState(workspace)
    return this.stateOf(workspace)
  }

  async navigate(options: BrowserNavigateOptions & { actor?: 'agent' | 'user' }): Promise<BrowserTabState> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const url = this.normalizeUrl(workspace, options.url)
    let tab: BrowserTab
    if (options.newTab || (!options.tabId && !workspace.activeTabId)) {
      const state = await this.createTab(options.sessionId, options.workspacePath, undefined, true)
      tab = this.requireTab(workspace, state.id)
    } else {
      tab = this.resolveTab(workspace, options.tabId)
    }
    this.show(options.sessionId, tab.id)
    tab.loading = true
    tab.url = url
    this.emitState(workspace)
    try {
      await tab.view.webContents.loadURL(url)
    } catch (error) {
      tab.loading = false
      this.emitState(workspace)
      throw new Error(`网页导航失败：${errorMessage(error)}`)
    }
    return this.tabState(tab)
  }

  goBack(sessionId: string, workspacePath: string, tabId?: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    const tab = this.resolveTab(workspace, tabId)
    if (tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack()
    return this.stateOf(workspace)
  }

  goForward(sessionId: string, workspacePath: string, tabId?: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    const tab = this.resolveTab(workspace, tabId)
    if (tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward()
    return this.stateOf(workspace)
  }

  reload(sessionId: string, workspacePath: string, tabId?: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    this.resolveTab(workspace, tabId).view.webContents.reload()
    return this.stateOf(workspace)
  }

  stop(sessionId: string, workspacePath: string, tabId?: string): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    this.resolveTab(workspace, tabId).view.webContents.stop()
    return this.stateOf(workspace)
  }

  setBounds(sessionId: string, workspacePath: string, bounds: BrowserBounds): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    this.bounds = this.validateBounds(bounds)
    this.visibleSessionId = this.bounds.visible ? sessionId : this.visibleSessionId === sessionId ? null : this.visibleSessionId
    this.bindHostLifecycle()
    this.applyVisibility()
    return this.stateOf(workspace)
  }

  hide(sessionId: string): void {
    if (this.visibleSessionId === sessionId) {
      this.visibleSessionId = null
      this.bounds = { ...this.bounds, visible: false }
      this.applyVisibility()
    }
  }

  async setReuseLogin(sessionId: string, workspacePath: string, enabled: boolean): Promise<BrowserState> {
    const existing = this.workspaces.get(sessionId)
    const key = this.workspaceKey(sessionId, workspacePath)
    if (existing?.reuseLogin === enabled) return this.stateOf(existing)
    this.options.settings.setString(`browser:reuseLogin:${key}`, String(enabled))
    if (existing) this.destroyWorkspace(existing)
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    await this.createTab(sessionId, workspacePath)
    return this.stateOf(workspace)
  }

  setAllowPrivateNetwork(sessionId: string, workspacePath: string, enabled: boolean): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    const key = this.workspaceKey(sessionId, workspacePath)
    workspace.allowPrivateNetwork = enabled
    this.options.settings.setString(`browser:allowPrivateNetwork:${key}`, String(enabled))
    this.emitState(workspace)
    return this.stateOf(workspace)
  }

  setControlMode(sessionId: string, workspacePath: string, mode: BrowserControlMode): BrowserState {
    const workspace = this.ensureWorkspace(sessionId, workspacePath)
    workspace.controlMode = mode
    this.emitState(workspace)
    return this.stateOf(workspace)
  }

  async click(options: BrowserClickOptions & { actor?: 'agent' | 'user' }): Promise<{ tabId: string; url: string; selector?: string; x: number; y: number }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const tab = this.resolveTab(workspace, options.tabId)
    this.show(options.sessionId, tab.id)
    const debuggerApi = await this.attachDebugger(tab)
    let point: CdpNode
    if (options.selector) point = await this.nodePoint(tab, options.selector, true)
    else {
      if (!Number.isFinite(options.x) || !Number.isFinite(options.y)) throw new Error('browser_click 必须提供 selector 或 x/y 坐标')
      point = { nodeId: 0, x: options.x!, y: options.y! }
    }
    tab.view.webContents.focus()
    const button = options.button ?? 'left'
    const clickCount = options.clickCount ?? 1
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount })
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount })
    return { tabId: tab.id, url: tab.url, selector: options.selector, x: point.x, y: point.y }
  }

  async type(options: BrowserTypeOptions & { actor?: 'agent' | 'user' }): Promise<{ tabId: string; url: string; selector: string; characters: number; submitted: boolean }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const tab = this.resolveTab(workspace, options.tabId)
    this.show(options.sessionId, tab.id)
    const debuggerApi = await this.attachDebugger(tab)
    const node = await this.nodePoint(tab, options.selector, true)
    await debuggerApi.sendCommand('DOM.focus', { nodeId: node.nodeId })
    tab.view.webContents.focus()
    if (options.clear !== false) {
      await debuggerApi.sendCommand('Runtime.evaluate', {
        expression: clearFieldExpression(options.selector),
        awaitPromise: false,
        returnByValue: true
      })
      await debuggerApi.sendCommand('DOM.focus', { nodeId: node.nodeId })
    }
    if (options.text) await debuggerApi.sendCommand('Input.insertText', { text: options.text })
    if (options.submit) {
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    }
    return { tabId: tab.id, url: tab.url, selector: options.selector, characters: [...options.text].length, submitted: options.submit === true }
  }

  async scroll(options: BrowserScrollOptions & { actor?: 'agent' | 'user' }): Promise<{ tabId: string; url: string; x: number; y: number }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const tab = this.resolveTab(workspace, options.tabId)
    this.show(options.sessionId, tab.id)
    const debuggerApi = await this.attachDebugger(tab)
    const response = await debuggerApi.sendCommand('Runtime.evaluate', {
      expression: scrollExpression(options.selector, options.deltaX ?? 0, options.deltaY ?? 600),
      returnByValue: true
    }) as { result?: { value?: { x?: number; y?: number; error?: string } } }
    const value = response.result?.value
    if (value?.error) throw new Error(value.error)
    return { tabId: tab.id, url: tab.url, x: value?.x ?? 0, y: value?.y ?? 0 }
  }

  async snapshot(options: BrowserSnapshotOptions): Promise<{ tabId: string; url: string; title: string; markdown: string; truncated: boolean }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    const tab = this.resolveTab(workspace, options.tabId)
    const debuggerApi = await this.attachDebugger(tab)
    const payload = await debuggerApi.sendCommand('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includeDOMRects: true,
      includePaintOrder: false,
      includeBlendedBackgroundColors: false,
      includeTextColorOpacities: false
    }) as DomSnapshotPayload
    const snapshot = domSnapshotToMarkdown(payload, options.maxChars)
    return { tabId: tab.id, url: snapshot.url || tab.url, title: snapshot.title || tab.title, markdown: snapshot.markdown, truncated: snapshot.truncated }
  }

  async screenshot(options: BrowserScreenshotOptions): Promise<{ tabId: string; url: string; path: string; bytes: number; width: number; height: number }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    const tab = this.resolveTab(workspace, options.tabId)
    const debuggerApi = await this.attachDebugger(tab)
    const target = resolveAuthorizedPath(
      options.workspacePath,
      options.path ?? join('.starbit', 'browser-screenshots', `${nanoid('capture')}.png`),
      options.grantedRoots
    )
    if (extname(target).toLowerCase() !== '.png') throw new Error('浏览器截图路径必须使用 .png 扩展名')
    await assertMissing(target, '截图目标已存在，请选择新文件名')
    await mkdir(dirname(target), { recursive: true })
    const capture: Record<string, unknown> = { format: 'png', fromSurface: true, captureBeyondViewport: options.fullPage === true }
    if (options.fullPage) {
      const metrics = await debuggerApi.sendCommand('Page.getLayoutMetrics') as { cssContentSize?: { x?: number; y?: number; width?: number; height?: number } }
      const content = metrics.cssContentSize
      const maximum = this.options.maxScreenshotDimension ?? MAX_SCREENSHOT_DIMENSION
      if (content) capture.clip = {
        x: content.x ?? 0,
        y: content.y ?? 0,
        width: Math.min(maximum, Math.max(1, Math.ceil(content.width ?? 1))),
        height: Math.min(maximum, Math.max(1, Math.ceil(content.height ?? 1))),
        scale: 1
      }
    }
    const result = await debuggerApi.sendCommand('Page.captureScreenshot', capture) as { data?: string }
    if (!result.data) throw new Error('浏览器未返回截图数据')
    const bytes = Buffer.from(result.data, 'base64')
    await writeFile(target, bytes)
    const size = nativeImage.createFromBuffer(bytes).getSize()
    return { tabId: tab.id, url: tab.url, path: target, bytes: bytes.byteLength, width: size.width, height: size.height }
  }

  async download(options: BrowserDownloadOptions & { actor?: 'agent' | 'user' }): Promise<{ tabId: string; url: string; path: string; bytes: number }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const tab = this.resolveTab(workspace, options.tabId)
    const sourceUrl = this.normalizeUrl(workspace, options.url)
    const targetPath = resolveAuthorizedPath(options.workspacePath, options.path, options.grantedRoots)
    if (!options.overwrite) await assertMissing(targetPath, '下载目标已存在；如需覆盖请显式设置 overwrite=true')
    await mkdir(dirname(targetPath), { recursive: true })
    if (this.pendingDownloads.has(tab.view.webContents.id)) throw new Error('当前标签已有下载任务正在进行')

    return new Promise((resolveDownload, rejectDownload) => {
      const webContentsId = tab.view.webContents.id
      const finish = (error?: Error, result?: { tabId: string; url: string; path: string; bytes: number }): void => {
        const pending = this.pendingDownloads.get(webContentsId)
        if (!pending) return
        clearTimeout(pending.timer)
      options.signal?.removeEventListener('abort', pending.abort)
        this.pendingDownloads.delete(webContentsId)
        if (error) rejectDownload(error)
        else resolveDownload(result!)
      }
      const timer = setTimeout(() => finish(new Error('浏览器下载超时')), this.options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS)
      const pending: PendingDownload = {
        sessionId: options.sessionId,
        tabId: tab.id,
        sourceUrl,
        targetPath,
        timer,
        resolve: (result) => finish(undefined, result),
        reject: (reason) => finish(reason),
        abort: () => undefined
      }
      pending.abort = () => {
        pending.item?.cancel()
        pending.reject(new Error('浏览器下载已取消'))
      }
      options.signal?.addEventListener('abort', pending.abort, { once: true })
      this.pendingDownloads.set(webContentsId, pending)
      try {
        tab.view.webContents.downloadURL(sourceUrl)
      } catch (error) {
        finish(new Error(`无法启动下载：${errorMessage(error)}`))
      }
    })
  }

  async upload(options: BrowserUploadOptions & { actor?: 'agent' | 'user' }): Promise<{ tabId: string; url: string; selector: string; paths: string[] }> {
    const workspace = this.ensureWorkspace(options.sessionId, options.workspacePath)
    this.assertAgentControl(workspace, options.actor)
    const tab = this.resolveTab(workspace, options.tabId)
    const paths: string[] = []
    for (const inputPath of options.paths) {
      const target = resolveAuthorizedPath(options.workspacePath, inputPath, options.grantedRoots)
      const info = await stat(target)
      if (!info.isFile()) throw new Error(`上传目标不是文件：${target}`)
      paths.push(target)
    }
    const debuggerApi = await this.attachDebugger(tab)
    const node = await this.findNode(tab, options.selector)
    await debuggerApi.sendCommand('DOM.setFileInputFiles', { files: paths, nodeId: node.nodeId })
    await this.highlightNode(tab, node.nodeId)
    return { tabId: tab.id, url: tab.url, selector: options.selector, paths }
  }

  show(sessionId: string, tabId?: string): void {
    const workspace = this.workspaces.get(sessionId)
    if (!workspace) return
    if (tabId) {
      this.requireTab(workspace, tabId)
      workspace.activeTabId = tabId
    }
    this.visibleSessionId = sessionId
    this.options.emit({ type: 'browser/show', sessionId })
    this.applyVisibility()
    this.emitState(workspace)
  }

  close(): void {
    for (const pending of this.pendingDownloads.values()) pending.reject(new Error('应用正在关闭，下载已取消'))
    this.pendingDownloads.clear()
    for (const workspace of [...this.workspaces.values()]) this.destroyWorkspace(workspace)
    this.visibleSessionId = null
  }

  private ensureWorkspace(sessionId: string, workspacePath: string): BrowserWorkspace {
    const normalizedPath = resolve(workspacePath)
    const current = this.workspaces.get(sessionId)
    if (current) {
      if (current.workspacePath !== normalizedPath) throw new Error('浏览器会话工作区不匹配')
      return current
    }
    const key = this.workspaceKey(sessionId, normalizedPath)
    const reuseLogin = this.options.settings.getString(`browser:reuseLogin:${key}`, 'false') === 'true'
    const allowPrivateNetwork = this.options.settings.getString(`browser:allowPrivateNetwork:${key}`, 'false') === 'true'
    const partition = reuseLogin ? `persist:starbit-browser-${key}` : `starbit-browser-${this.instanceNonce}-${key}`
    const browserSession = electronSession.fromPartition(partition, { cache: true })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    const workspace: BrowserWorkspace = {
      sessionId,
      workspacePath: normalizedPath,
      partition,
      session: browserSession,
      reuseLogin,
      allowPrivateNetwork,
      controlMode: 'agent',
      activeTabId: null,
      tabs: new Map(),
      downloadListener: (event, item, webContents) => this.onWillDownload(event, item, webContents)
    }
    browserSession.on('will-download', workspace.downloadListener)
    this.workspaces.set(sessionId, workspace)
    return workspace
  }

  private configureTab(workspace: BrowserWorkspace, tab: BrowserTab): void {
    const contents = tab.view.webContents
    contents.setWindowOpenHandler((details) => {
      try {
        const url = this.normalizeUrl(workspace, details.url)
        queueMicrotask(() => void this.createTab(workspace.sessionId, workspace.workspacePath, url, true).catch((error) => this.emitError(workspace.sessionId, error)))
      } catch (error) {
        this.emitError(workspace.sessionId, error)
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event) => this.guardNavigation(workspace, event))
    contents.on('will-redirect', (event) => this.guardNavigation(workspace, event))
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) this.guardNavigation(workspace, event)
    })
    contents.on('did-start-loading', () => {
      tab.loading = true
      this.emitState(workspace)
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      this.refreshTabMetadata(tab)
      this.emitState(workspace)
    })
    contents.on('did-navigate', () => {
      this.refreshTabMetadata(tab)
      this.emitState(workspace)
    })
    contents.on('did-navigate-in-page', () => {
      this.refreshTabMetadata(tab)
      this.emitState(workspace)
    })
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      tab.title = cleanTitle(title)
      this.emitState(workspace)
    })
    contents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault()
      callback()
      this.emitError(workspace.sessionId, new Error('已阻止网页请求系统级认证凭据'))
    })
    contents.on('render-process-gone', (_event, details) => {
      tab.loading = false
      this.emitError(workspace.sessionId, new Error(`浏览器页面进程已退出：${details.reason}`))
      this.emitState(workspace)
    })
  }

  private guardNavigation(workspace: BrowserWorkspace, event: Electron.Event<{ url?: string }>): void {
    const url = event.url ?? ''
    if (url === INTERNAL_BLANK_URL) return
    try {
      this.normalizeUrl(workspace, url)
    } catch (error) {
      event.preventDefault()
      this.emitError(workspace.sessionId, error)
    }
  }

  private normalizeUrl(workspace: BrowserWorkspace, input: string): string {
    const searchUrlTemplate = this.options.settings.getString('browser:searchUrlTemplate', DEFAULT_SEARCH_URL_TEMPLATE)
    const url = normalizeBrowserUrl(input, { searchUrlTemplate })
    if (!workspace.allowPrivateNetwork && isPrivateNetworkUrl(url)) {
      throw new Error('已阻止访问本机或私有网络；请由用户在浏览器面板中显式开启私网访问')
    }
    return url
  }

  private async attachDebugger(tab: BrowserTab): Promise<WebContents['debugger']> {
    const debuggerApi = tab.view.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    await debuggerApi.sendCommand('Page.enable')
    await debuggerApi.sendCommand('DOM.enable')
    return debuggerApi
  }

  private async findNode(tab: BrowserTab, selector: string): Promise<{ nodeId: number }> {
    const debuggerApi = await this.attachDebugger(tab)
    const document = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true }) as { root?: { nodeId?: number } }
    const rootId = document.root?.nodeId
    if (!rootId) throw new Error('无法读取页面 DOM')
    let query: { nodeId?: number }
    try {
      query = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: rootId, selector }) as { nodeId?: number }
    } catch (error) {
      throw new Error(`CSS selector 无效：${errorMessage(error)}`)
    }
    if (!query.nodeId) throw new Error(`页面未找到元素：${selector}`)
    return { nodeId: query.nodeId }
  }

  private async nodePoint(tab: BrowserTab, selector: string, highlight: boolean): Promise<CdpNode> {
    const debuggerApi = await this.attachDebugger(tab)
    const node = await this.findNode(tab, selector)
    await debuggerApi.sendCommand('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId })
    const result = await debuggerApi.sendCommand('DOM.getBoxModel', { nodeId: node.nodeId }) as { model?: { content?: number[]; border?: number[] } }
    const quad = result.model?.content ?? result.model?.border
    if (!quad || quad.length < 8) throw new Error(`元素不可见或没有可点击区域：${selector}`)
    if (highlight) await this.highlightNode(tab, node.nodeId)
    return { nodeId: node.nodeId, x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 }
  }

  private async highlightNode(tab: BrowserTab, nodeId: number): Promise<void> {
    const debuggerApi = await this.attachDebugger(tab)
    await debuggerApi.sendCommand('Overlay.enable')
    await debuggerApi.sendCommand('Overlay.highlightNode', {
      nodeId,
      highlightConfig: {
        showInfo: false,
        showStyles: false,
        contentColor: { r: 59, g: 111, b: 240, a: 0.12 },
        borderColor: { r: 59, g: 111, b: 240, a: 0.95 }
      }
    })
    await delay(HIGHLIGHT_DURATION_MS)
    await debuggerApi.sendCommand('Overlay.hideHighlight')
  }

  private onWillDownload(event: Electron.Event, item: DownloadItem, webContents: WebContents): void {
    const pending = this.pendingDownloads.get(webContents.id)
    const sourceChain = item.getURLChain()
    if (!pending || (!sourceChain.includes(pending.sourceUrl) && item.getURL() !== pending.sourceUrl)) {
      event.preventDefault()
      const workspace = [...this.workspaces.values()].find((candidate) => [...candidate.tabs.values()].some((tab) => tab.view.webContents.id === webContents.id))
      if (workspace) this.options.emit({
        type: 'browser/download',
        download: { sessionId: workspace.sessionId, tabId: workspace.activeTabId ?? '', url: item.getURL(), status: 'blocked', message: '页面自行发起的下载已拦截，请使用 browser_download 并确认保存位置' }
      })
      return
    }
    item.setSavePath(pending.targetPath)
    const base: Omit<BrowserDownloadState, 'status'> = { sessionId: pending.sessionId, tabId: pending.tabId, url: item.getURL(), targetPath: pending.targetPath }
    this.options.emit({ type: 'browser/download', download: { ...base, status: 'started', receivedBytes: 0, totalBytes: item.getTotalBytes() } })
    item.on('updated', (_updatedEvent, state) => {
      this.options.emit({
        type: 'browser/download',
        download: { ...base, status: state === 'progressing' ? 'progressing' : 'interrupted', receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() }
      })
    })
    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        const status = state === 'cancelled' ? 'cancelled' : 'interrupted'
        this.options.emit({ type: 'browser/download', download: { ...base, status, message: `下载${status === 'cancelled' ? '已取消' : '中断'}` } })
        pending.reject(new Error(`浏览器下载未完成：${state}`))
        return
      }
      const info = await stat(pending.targetPath).catch(() => null)
      const bytes = info?.size ?? item.getReceivedBytes()
      this.options.emit({ type: 'browser/download', download: { ...base, status: 'completed', receivedBytes: bytes, totalBytes: bytes } })
      pending.resolve({ tabId: pending.tabId, url: item.getURL(), path: pending.targetPath, bytes })
    })
    pending.item = item
  }

  private validateBounds(input: BrowserBounds): BrowserBounds {
    const host = this.requireHostWindow()
    const content = host.getContentBounds()
    const values = [input.x, input.y, input.width, input.height]
    if (!values.every(Number.isFinite)) throw new Error('浏览器面板边界无效')
    const x = clamp(Math.round(input.x), 0, content.width)
    const y = clamp(Math.round(input.y), 0, content.height)
    const width = clamp(Math.round(input.width), 0, content.width - x)
    const height = clamp(Math.round(input.height), 0, content.height - y)
    return { x, y, width, height, visible: input.visible && width > 0 && height > 0 }
  }

  private applyVisibility(): void {
    for (const workspace of this.workspaces.values()) {
      for (const tab of workspace.tabs.values()) {
        const visible = this.bounds.visible && workspace.sessionId === this.visibleSessionId && tab.id === workspace.activeTabId
        tab.view.setVisible(visible)
        if (visible) tab.view.setBounds(this.bounds as Rectangle)
      }
    }
  }

  private addViewToHost(view: WebContentsView): void {
    const host = this.requireHostWindow()
    this.bindHostLifecycle()
    if (!host.contentView.children.includes(view)) host.contentView.addChildView(view)
  }

  private bindHostLifecycle(): void {
    const host = this.requireHostWindow()
    if (host.id === this.boundHostId) return
    this.boundHostId = host.id
    host.webContents.on('did-start-loading', () => {
      this.bounds = { ...this.bounds, visible: false }
      this.visibleSessionId = null
      this.applyVisibility()
    })
    host.on('closed', () => {
      this.boundHostId = null
      this.close()
    })
  }

  private requireHostWindow(): BrowserWindow {
    const host = this.options.getHostWindow()
    if (!host || host.isDestroyed()) throw new Error('主窗口尚未就绪，无法显示浏览器')
    return host
  }

  private resolveTab(workspace: BrowserWorkspace, tabId?: string, createIfMissing = false): BrowserTab {
    const id = tabId ?? workspace.activeTabId
    if (id) return this.requireTab(workspace, id)
    if (!createIfMissing) throw new Error('浏览器没有可用标签页')
    throw new Error('浏览器标签页尚未创建')
  }

  private requireTab(workspace: BrowserWorkspace, tabId: string): BrowserTab {
    const tab = workspace.tabs.get(tabId)
    if (!tab) throw new Error(`浏览器标签页不存在：${tabId}`)
    return tab
  }

  private refreshTabMetadata(tab: BrowserTab): void {
    if (tab.view.webContents.isDestroyed()) return
    const currentUrl = tab.view.webContents.getURL()
    tab.url = currentUrl === INTERNAL_BLANK_URL ? '' : currentUrl
    tab.title = cleanTitle(tab.view.webContents.getTitle()) || (tab.url ? new URL(tab.url).hostname : '新标签页')
  }

  private tabState(tab: BrowserTab): BrowserTabState {
    const contents = tab.view.webContents
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      loading: tab.loading,
      canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward()
    }
  }

  private stateOf(workspace: BrowserWorkspace): BrowserState {
    return {
      sessionId: workspace.sessionId,
      activeTabId: workspace.activeTabId,
      tabs: [...workspace.tabs.values()].map((tab) => this.tabState(tab)),
      reuseLogin: workspace.reuseLogin,
      allowPrivateNetwork: workspace.allowPrivateNetwork,
      controlMode: workspace.controlMode
    }
  }

  private emitState(workspace: BrowserWorkspace): void {
    this.options.emit({ type: 'browser/state', state: this.stateOf(workspace) })
  }

  private emitError(sessionId: string, error: unknown): void {
    this.options.emit({ type: 'browser/error', sessionId, message: errorMessage(error) })
  }

  private assertAgentControl(workspace: BrowserWorkspace, actor: 'agent' | 'user' | undefined): void {
    if (actor !== 'user' && workspace.controlMode === 'human') throw new Error('浏览器正处于人工接管状态，请等待用户交还控制权')
  }

  private destroyTab(tab: BrowserTab): void {
    const host = this.options.getHostWindow()
    if (host && !host.isDestroyed() && host.contentView.children.includes(tab.view)) host.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) {
      if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach()
      tab.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  private destroyWorkspace(workspace: BrowserWorkspace): void {
    workspace.session.removeListener('will-download', workspace.downloadListener)
    for (const tab of workspace.tabs.values()) this.destroyTab(tab)
    workspace.tabs.clear()
    this.workspaces.delete(workspace.sessionId)
    if (this.visibleSessionId === workspace.sessionId) this.visibleSessionId = null
  }

  private workspaceKey(sessionId: string, workspacePath: string): string {
    return createHash('sha256').update(`${sessionId}\0${resolve(workspacePath)}`).digest('hex').slice(0, 24)
  }
}

function cleanTitle(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160)
}

function clearFieldExpression(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return { error: '页面未找到可输入元素' };
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, ''); else element.value = '';
    } else if (element.isContentEditable) element.textContent = '';
    else return { error: '目标元素不可输入' };
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`
}

function scrollExpression(selector: string | undefined, deltaX: number, deltaY: number): string {
  return `(() => {
    const target = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'window'};
    if (!target) return { error: '页面未找到滚动目标' };
    target.scrollBy({ left: ${JSON.stringify(deltaX)}, top: ${JSON.stringify(deltaY)}, behavior: 'instant' });
    return target === window ? { x: window.scrollX, y: window.scrollY } : { x: target.scrollLeft, y: target.scrollTop };
  })()`
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await access(path)
    throw new Error(`${message}：${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(message)) throw error
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
