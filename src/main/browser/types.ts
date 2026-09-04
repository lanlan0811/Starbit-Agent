export type BrowserControlMode = 'agent' | 'human'

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface BrowserTabState {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserState {
  sessionId: string
  activeTabId: string | null
  tabs: BrowserTabState[]
  reuseLogin: boolean
  allowPrivateNetwork: boolean
  controlMode: BrowserControlMode
}

export interface BrowserDownloadState {
  sessionId: string
  tabId: string
  url: string
  targetPath?: string
  receivedBytes?: number
  totalBytes?: number
  status: 'started' | 'progressing' | 'completed' | 'cancelled' | 'interrupted' | 'blocked'
  message?: string
}

export type BrowserManagerEvent =
  | { type: 'browser/state'; state: BrowserState }
  | { type: 'browser/show'; sessionId: string }
  | { type: 'browser/download'; download: BrowserDownloadState }
  | { type: 'browser/error'; sessionId: string; message: string }

export interface BrowserNavigateOptions {
  sessionId: string
  workspacePath: string
  url: string
  tabId?: string
  newTab?: boolean
}

export interface BrowserClickOptions {
  sessionId: string
  workspacePath: string
  tabId?: string
  selector?: string
  x?: number
  y?: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
}

export interface BrowserTypeOptions {
  sessionId: string
  workspacePath: string
  tabId?: string
  selector: string
  text: string
  clear?: boolean
  submit?: boolean
}

export interface BrowserScrollOptions {
  sessionId: string
  workspacePath: string
  tabId?: string
  selector?: string
  deltaX?: number
  deltaY?: number
}

export interface BrowserSnapshotOptions {
  sessionId: string
  workspacePath: string
  tabId?: string
  maxChars?: number
}

export interface BrowserScreenshotOptions {
  sessionId: string
  workspacePath: string
  grantedRoots?: string[]
  tabId?: string
  path?: string
  fullPage?: boolean
}

export interface BrowserDownloadOptions {
  sessionId: string
  workspacePath: string
  grantedRoots?: string[]
  tabId?: string
  url: string
  path: string
  overwrite?: boolean
  signal?: AbortSignal
}

export interface BrowserUploadOptions {
  sessionId: string
  workspacePath: string
  grantedRoots?: string[]
  tabId?: string
  selector: string
  paths: string[]
}

export interface BrowserAutomation {
  navigate(options: BrowserNavigateOptions): Promise<BrowserTabState>
  click(options: BrowserClickOptions): Promise<{ tabId: string; url: string; selector?: string; x: number; y: number }>
  type(options: BrowserTypeOptions): Promise<{ tabId: string; url: string; selector: string; characters: number; submitted: boolean }>
  scroll(options: BrowserScrollOptions): Promise<{ tabId: string; url: string; x: number; y: number }>
  snapshot(options: BrowserSnapshotOptions): Promise<{ tabId: string; url: string; title: string; markdown: string; truncated: boolean }>
  screenshot(options: BrowserScreenshotOptions): Promise<{ tabId: string; url: string; path: string; bytes: number; width: number; height: number }>
  download(options: BrowserDownloadOptions): Promise<{ tabId: string; url: string; path: string; bytes: number }>
  upload(options: BrowserUploadOptions): Promise<{ tabId: string; url: string; selector: string; paths: string[] }>
}
