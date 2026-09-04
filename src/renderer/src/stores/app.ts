import { create } from 'zustand'
import type { SessionMeta } from '@core/session'
import type { SessionEvent, PermissionMode } from '@core/events'
import type { ModelConfig } from '@core/models'
import type { ThinkingLevel } from '@core/models'

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
  rightPanel: 'browser' | 'terminal' | null
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
  setRightPanel: (panel: AppState['rightPanel']) => void
}

export const useAppStore = create<AppState>((set) => ({
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
  rightPanel: null,
  setReady: (v) => set({ ready: v }),
  setAppVersion: (v) => set({ appVersion: v }),
  setWorkspacePath: (p) => set({ workspacePath: p }),
  setSessions: (s) => set({ sessions: s }),
  setCurrentSessionId: (id, events) =>
    set({ currentSessionId: id, events: events ?? (id ? useAppStore.getState().events : []) }),
  setEvents: (e) => set({ events: e }),
  appendEvent: (e) => set((s) => ({ events: [...s.events, e] })),
  setModels: (m) => set({ models: m }),
  setModel: (id) => set({ currentModel: id }),
  setMode: (m) => set({ mode: m }),
  setAgentStatus: (s) => set({ agentStatus: s }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setActiveSection: (section) => set({ activeSection: section }),
  setPermissionPrompt: (request) => set({ permissionPrompt: request }),
  setRightPanel: (panel) => set({ rightPanel: panel })
}))
