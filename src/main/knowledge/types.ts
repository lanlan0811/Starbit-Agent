export type KnowledgeSourceType = 'markdown' | 'text' | 'html' | 'pdf' | 'docx' | 'url'

export type KnowledgeDocumentStatus = 'processing' | 'indexed' | 'failed'

export interface KnowledgeBaseRecord {
  id: string
  name: string
  description: string
  documentCount: number
  chunkCount: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeDocumentRecord {
  id: string
  knowledgeBaseId: string
  sourceType: KnowledgeSourceType
  source: string
  displayName: string
  status: KnowledgeDocumentStatus
  error?: string
  contentHash: string
  chunkCount: number
  embeddingModel: string
  embeddingDimensions: number
  metadata: Record<string, string | number | boolean | null>
  createdAt: number
  updatedAt: number
}

export interface KnowledgeChunkRecord {
  id: string
  documentId: string
  knowledgeBaseId: string
  ordinal: number
  content: string
  startCharacter: number
  endCharacter: number
}

export interface KnowledgeSearchHit extends KnowledgeChunkRecord {
  score: number
  source: string
  displayName: string
  sourceType: KnowledgeSourceType
  metadata: Record<string, string | number | boolean | null>
}

export interface ChunkingOptions {
  maxCharacters?: number
  overlapCharacters?: number
  minimumCharacters?: number
}

export interface ImportDocumentOptions {
  knowledgeBaseId: string
  path: string
  displayName?: string
  metadata?: Record<string, string | number | boolean | null>
  signal?: AbortSignal
}

export interface ImportUrlOptions {
  knowledgeBaseId: string
  url: string
  displayName?: string
  metadata?: Record<string, string | number | boolean | null>
  signal?: AbortSignal
}

export interface KnowledgeSearchOptions {
  knowledgeBaseId?: string
  topK?: number
  minimumScore?: number
  signal?: AbortSignal
}

export interface ExtractedDocument {
  content: string
  sourceType: KnowledgeSourceType
  displayName: string
  metadata: Record<string, string | number | boolean | null>
}
