import { create } from 'zustand'
import type { SessionMeta } from '@core/session'
import type { SessionEvent, PermissionMode } from '@core/events'
import type { ModelConfig } from '@core/models'
import type { ThinkingLevel } from '@core/models'
import type { CacheDiagnostic, CompactionConfirmationRequest } from '../../../main/agent/loop'
import type { ContextStatus } from '../../../main/agent/context'

interface CompactionPromptState extends CompactionConfirmationRequest {
  requestId: string
  sessionId: string
}

export interface PermissionPromptState {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  semanticLabel: string
  subject: string
  command?: string
  impact: string
  mode: PermissionMode
}

interface AppState {
  ready: boolean
  appVersion: string
  workspacePath: string
  sessions: SessionMeta[]
  currentSessionId: string | null
  events: SessionEvent[]
  models: ModelConfig[]
  currentModel: string
  mode: PermissionMode
  agentStatus: 'idle' | 'running' | 'waiting-confirmation'
  thinkingLevel: ThinkingLevel
  activeSection: string
  permissionPrompt: PermissionPromptState | null
  compactionPrompt: CompactionPromptState | null
  streamingText: string
  streamingThinking: string
  contextStatus: ContextStatus | null
  cacheDiagnostic: CacheDiagnostic | null
  rightPanel: 'browser' | 'terminal' | null
  /** 文件树面板请求输入框插入的 @引用（消费后清空） */
  pendingFileRef: string | null
  setReady: (v: boolean) => void
  setAppVersion: (v: string) => void
  setWorkspacePath: (p: string) => void
  setSessions: (s: SessionMeta[]) => void
  setCurrentSessionId: (id: string | null, events?: SessionEvent[]) => void
  setEvents: (e: SessionEvent[]) => void
  appendEvent: (e: SessionEvent) => void
  setModels: (m: ModelConfig[]) => void
  setModel: (id: string) => void
  setMode: (m: PermissionMode) => void
  setAgentStatus: (s: AppState['agentStatus']) => void
  setThinkingLevel: (level: ThinkingLevel) => void
  setActiveSection: (section: string) => void
  setPermissionPrompt: (request: PermissionPromptState | null) => void
  setCompactionPrompt: (request: CompactionPromptState | null) => void
  appendStreamDelta: (delta: { text?: string; thinking?: string }) => void
  clearStream: () => void
  setContextStatus: (status: ContextStatus | null) => void
  setCacheDiagnostic: (diagnostic: CacheDiagnostic | null) => void
  setRightPanel: (panel: AppState['rightPanel']) => void
  queueFileRef: (path: string) => void
  consumeFileRef: () => string | null
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  appVersion: '',
  workspacePath: '',
  sessions: [],
  currentSessionId: null,
  events: [],
  models: [],
  currentModel: 'qwen3.8-max',
  mode: 'fullAccess',
  agentStatus: 'idle',
  thinkingLevel: 'max',
  activeSection: 'sessions',
  permissionPrompt: null,
  compactionPrompt: null,
  streamingText: '',
  streamingThinking: '',
  contextStatus: null,
  cacheDiagnostic: null,
  rightPanel: null,
  pendingFileRef: null,
  setReady: (v) => set({ ready: v }),
  setAppVersion: (v) => set({ appVersion: v }),
  setWorkspacePath: (p) => set({ workspacePath: p }),
  setSessions: (s) => set({ sessions: s }),
  setCurrentSessionId: (id, events) =>
    set({ currentSessionId: id, events: events ?? [], streamingText: '', streamingThinking: '', contextStatus: null, cacheDiagnostic: null,
      permissionPrompt: null, compactionPrompt: null, agentStatus: 'idle' }),
  setEvents: (e) => set({ events: e }),
  appendEvent: (e) => set((s) => ({ events: [...s.events, e] })),
  setModels: (m) => set({ models: m }),
  setModel: (id) => set({ currentModel: id }),
  setMode: (m) => set({ mode: m }),
  setAgentStatus: (s) => set({ agentStatus: s }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setActiveSection: (section) => set({ activeSection: section }),
  setPermissionPrompt: (request) => set({ permissionPrompt: request }),
  setCompactionPrompt: (request) => set({ compactionPrompt: request }),
  appendStreamDelta: (delta) => set((state) => ({
    streamingText: `${state.streamingText}${delta.text ?? ''}`,
    streamingThinking: `${state.streamingThinking}${delta.thinking ?? ''}`
  })),
  clearStream: () => set({ streamingText: '', streamingThinking: '' }),
  setContextStatus: (status) => set({ contextStatus: status }),
  setCacheDiagnostic: (diagnostic) => set({ cacheDiagnostic: diagnostic }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  queueFileRef: (path) => set({ pendingFileRef: path }),
  consumeFileRef: (): string | null => {
    const value = get().pendingFileRef
    if (value !== null) set({ pendingFileRef: null })
    return value
  }
}))
