export type MemoryScope = 'user' | 'workspace'
export type MemorySource = 'manual' | 'session'

export interface MemoryEntry {
  id: string
  scope: MemoryScope
  source: MemorySource
  content: string
  sessionId?: string
  createdAt: number
  updatedAt: number
}

export interface MemorySearchHit {
  id: string
  scope: MemoryScope
  source: MemorySource | 'document'
  content: string
  score: number
  path: string
  sessionId?: string
  updatedAt?: number
}

export interface MemoryContext {
  userMemory: string
  workspaceMemory: string
  projectRules: string
  systemSection: string
}
