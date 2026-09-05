import Database, { type Database as SqliteDatabase } from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chunkText } from './chunking'
import {
  ConfigurableEmbeddingProvider,
  cosineSimilarity,
  localFeatureHashEmbedding,
  type EmbeddingConfig,
  type EmbeddingProvider
} from './embeddings'
import { extractDocumentFromFile, extractDocumentFromUrl, type DocumentParserOptions } from './parsers'
import type {
  ChunkingOptions,
  ExtractedDocument,
  ImportDocumentOptions,
  ImportUrlOptions,
  KnowledgeBaseRecord,
  KnowledgeDocumentRecord,
  KnowledgeSearchHit,
  KnowledgeSearchOptions,
  KnowledgeSourceType
} from './types'

export interface KnowledgeStoreOptions {
  workspacePath: string
  /** 传入 :memory: 可建立不落盘的测试/临时知识库。 */
  databasePath?: string
  embedding?: EmbeddingConfig | EmbeddingProvider
  chunking?: ChunkingOptions
  parser?: DocumentParserOptions
  localFallbackDimensions?: number
  maxSearchCandidates?: number
  now?: () => number
  idFactory?: () => string
}

interface DocumentIdentity {
  id: string
  createdAt: number
}

interface ChunkSearchRow {
  id: string
  document_id: string
  knowledge_base_id: string
  ordinal: number
  content: string
  start_character: number
  end_character: number
  embedding: Buffer
  local_embedding: Buffer
  embedding_model: string
  embedding_dimensions: number
  source: string
  display_name: string
  source_type: KnowledgeSourceType
  metadata_json: string
}

const DEFAULT_LOCAL_DIMENSIONS = 384
const DEFAULT_MAX_SEARCH_CANDIDATES = 50_000

/**
 * 每工作区独立的 SQLite 知识库（better-sqlite3 同步引擎）。
 * 向量以 Float32 BLOB 持久化于 knowledge_chunks；同时通过 sqlite-vec 的
 * vec0 虚拟表建立 KNN 索引（按 embedding 维度自动重建），查询优先走
 * vec0 距离排序，扩展不可用或维度不匹配时回退 JS 余弦相似度。
 * 每个 chunk 同时保存确定性本地向量，使远端 embedding 暂时不可用时
 * 仍可检索已经建立的索引。
 */
export class KnowledgeStore {
  readonly workspacePath: string
  readonly databasePath: string

  private embeddingProvider: EmbeddingProvider
  private readonly chunking: ChunkingOptions
  private readonly parser: DocumentParserOptions
  private readonly localFallbackDimensions: number
  private readonly maxSearchCandidates: number
  private readonly now: () => number
  private readonly idFactory: () => string
  private mutation: Promise<unknown> = Promise.resolve()
  private closed = false
  /** sqlite-vec 扩展是否加载成功（打包环境首次加载失败时自动降级） */
  private vecAvailable = false
  /** vec0 表当前支持的向量维度；null 表示尚未建立 */
  private vecDimensions: number | null = null

  private constructor(
    private readonly database: SqliteDatabase,
    options: KnowledgeStoreOptions
  ) {
    this.workspacePath = resolve(options.workspacePath)
    this.databasePath = options.databasePath === ':memory:'
      ? ':memory:'
      : resolve(options.databasePath ?? join(this.workspacePath, '.starbit', 'knowledge.db'))
    this.embeddingProvider = isEmbeddingProvider(options.embedding)
      ? options.embedding
      : new ConfigurableEmbeddingProvider(options.embedding)
    this.chunking = options.chunking ?? {}
    this.parser = options.parser ?? {}
    this.localFallbackDimensions = integerOption(options.localFallbackDimensions, DEFAULT_LOCAL_DIMENSIONS, 16, 8192)
    this.maxSearchCandidates = integerOption(options.maxSearchCandidates, DEFAULT_MAX_SEARCH_CANDIDATES, 100, 1_000_000)
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.migrate()
  }

  static async open(options: KnowledgeStoreOptions): Promise<KnowledgeStore> {
    if (!options.workspacePath.trim()) throw new Error('知识库缺少工作区路径')
    const databasePath = options.databasePath === ':memory:'
      ? ':memory:'
      : resolve(options.databasePath ?? join(resolve(options.workspacePath), '.starbit', 'knowledge.db'))
    if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true })
    // @ts-expect-error enableLoadExtension 在 @types/better-sqlite3 9.x 中缺失，v13 运行时支持
    const database = new Database(databasePath, { enableLoadExtension: true })
    const store = new KnowledgeStore(database, { ...options, databasePath })
    return store
  }

  /** 设置只影响后续导入与查询；已有远端索引可调用 rebuildKnowledgeBase 更新。 */
  setEmbeddingProvider(provider: EmbeddingProvider | EmbeddingConfig): void {
    this.ensureOpen()
    this.embeddingProvider = isEmbeddingProvider(provider) ? provider : new ConfigurableEmbeddingProvider(provider)
  }

  async createKnowledgeBase(name: string, description = ''): Promise<KnowledgeBaseRecord> {
    const normalizedName = requiredText(name, '知识库名称', 200)
    const normalizedDescription = boundedText(description.trim(), '知识库描述', 4_000)
    return this.withMutation(async () => {
      const id = this.idFactory()
      const timestamp = this.now()
      this.run(
        'INSERT INTO knowledge_bases (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, normalizedName, normalizedDescription, timestamp, timestamp]
      )
      return {
        id,
        name: normalizedName,
        description: normalizedDescription,
        documentCount: 0,
        chunkCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    })
  }

  async ensureDefaultKnowledgeBase(name = '默认知识库'): Promise<KnowledgeBaseRecord> {
    const current = await this.listKnowledgeBases()
    return current[0] ?? this.createKnowledgeBase(name)
  }

  async listKnowledgeBases(): Promise<KnowledgeBaseRecord[]> {
    await this.waitForMutations()
    this.ensureOpen()
    return this.all<{
      id: string
      name: string
      description: string
      document_count: number
      chunk_count: number
      created_at: number
      updated_at: number
    }>(`
      SELECT kb.id, kb.name, kb.description, kb.created_at, kb.updated_at,
        COUNT(DISTINCT d.id) AS document_count,
        COUNT(c.id) AS chunk_count
      FROM knowledge_bases kb
      LEFT JOIN knowledge_documents d ON d.knowledge_base_id = kb.id
      LEFT JOIN knowledge_chunks c ON c.document_id = d.id
      GROUP BY kb.id
      ORDER BY kb.updated_at DESC, kb.name ASC
    `).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      documentCount: numberValue(row.document_count),
      chunkCount: numberValue(row.chunk_count),
      createdAt: numberValue(row.created_at),
      updatedAt: numberValue(row.updated_at)
    }))
  }

  async deleteKnowledgeBase(id: string): Promise<boolean> {
    return this.withMutation(async () => {
      const exists = Boolean(this.get<{ id: string }>('SELECT id FROM knowledge_bases WHERE id = ?', [id]))
      if (!exists) return false
      this.run('DELETE FROM knowledge_bases WHERE id = ?', [id])
      return true
    })
  }

  async listDocuments(knowledgeBaseId?: string): Promise<KnowledgeDocumentRecord[]> {
    await this.waitForMutations()
    this.ensureOpen()
    const where = knowledgeBaseId ? 'WHERE knowledge_base_id = ?' : ''
    return this.all<DocumentRow>(
      `SELECT * FROM knowledge_documents ${where} ORDER BY updated_at DESC, display_name ASC`,
      knowledgeBaseId ? [knowledgeBaseId] : []
    ).map(documentRecord)
  }

  async importDocument(options: ImportDocumentOptions): Promise<KnowledgeDocumentRecord> {
    this.ensureKnowledgeBaseExists(options.knowledgeBaseId)
    const source = resolve(options.path)
    const extracted = await extractDocumentFromFile(source, this.parser)
    return this.indexExtracted({
      knowledgeBaseId: options.knowledgeBaseId,
      source,
      extracted: {
        ...extracted,
        displayName: options.displayName?.trim() || extracted.displayName,
        metadata: { ...extracted.metadata, ...options.metadata }
      },
      signal: options.signal
    })
  }

  async importUrl(options: ImportUrlOptions): Promise<KnowledgeDocumentRecord> {
    this.ensureKnowledgeBaseExists(options.knowledgeBaseId)
    const normalizedUrl = normalizedHttpUrl(options.url)
    const extracted = await extractDocumentFromUrl(normalizedUrl, this.parser, options.signal)
    return this.indexExtracted({
      knowledgeBaseId: options.knowledgeBaseId,
      source: normalizedUrl,
      extracted: {
        ...extracted,
        displayName: options.displayName?.trim() || extracted.displayName,
        metadata: { ...extracted.metadata, ...options.metadata }
      },
      signal: options.signal
    })
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.withMutation(async () => {
      const row = this.get<{ knowledge_base_id: string }>('SELECT knowledge_base_id FROM knowledge_documents WHERE id = ?', [id])
      if (!row) return false
      this.run('DELETE FROM knowledge_documents WHERE id = ?', [id])
      this.touchKnowledgeBase(row.knowledge_base_id)
      return true
    })
  }

  async rebuildKnowledgeBase(knowledgeBaseId: string, signal?: AbortSignal): Promise<KnowledgeDocumentRecord[]> {
    this.ensureKnowledgeBaseExists(knowledgeBaseId)
    const documents = this.all<DocumentRow>(
      'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY created_at ASC',
      [knowledgeBaseId]
    )
    const rebuilt: KnowledgeDocumentRecord[] = []
    for (const document of documents) {
      if (signal?.aborted) throw abortError(signal.reason)
      rebuilt.push(await this.indexExtracted({
        knowledgeBaseId,
        source: document.source,
        documentId: document.id,
        createdAt: numberValue(document.created_at),
        extracted: {
          content: document.extracted_text,
          sourceType: document.source_type,
          displayName: document.display_name,
          metadata: parseMetadata(document.metadata_json)
        },
        signal,
        force: true
      }))
    }
    return rebuilt
  }

  async search(query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchHit[]> {
    const normalizedQuery = requiredText(query, '检索问题', 20_000)
    await this.waitForMutations()
    this.ensureOpen()
    if (options.knowledgeBaseId) this.ensureKnowledgeBaseExists(options.knowledgeBaseId)
    const topK = integerOption(options.topK, 6, 1, 50)
    const minimumScore = finiteOption(options.minimumScore, -1, -1, 1)
    const [queryBatch] = await Promise.all([
      this.embeddingProvider.embed([normalizedQuery], options.signal)
    ])
    const queryVector = queryBatch.vectors[0]
    if (!queryVector) return []

    // 优先 sqlite-vec KNN 索引；仅当主 embedding 模型/维度与索引一致时可用
    const vecHits = this.vecSearch(queryVector, topK)
    if (vecHits) {
      const filtered = this.hydrateHits(vecHits, queryBatch.model, queryBatch.dimensions, options.knowledgeBaseId, minimumScore, queryVector)
      if (filtered.length > 0 || this.vecCoversAllChunks()) return filtered.slice(0, topK)
    }

    // 回退：JS 余弦相似度（主向量优先，本地兜底向量保底可检索）
    const localQueryVector = localFeatureHashEmbedding(normalizedQuery, this.localFallbackDimensions)
    const where = options.knowledgeBaseId ? 'AND c.knowledge_base_id = ?' : ''
    const rows = this.all<ChunkSearchRow>(`
      SELECT c.id, c.document_id, c.knowledge_base_id, c.ordinal, c.content,
        c.start_character, c.end_character, c.embedding, c.local_embedding,
        d.embedding_model, d.embedding_dimensions, d.source, d.display_name,
        d.source_type, d.metadata_json
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE d.status = 'indexed' ${where}
      ORDER BY d.updated_at DESC, c.ordinal ASC
      LIMIT ?
    `, options.knowledgeBaseId ? [options.knowledgeBaseId, this.maxSearchCandidates] : [this.maxSearchCandidates])

    return rows
      .map((row): KnowledgeSearchHit | null => {
        const canUsePrimary = row.embedding_model === queryBatch.model && numberValue(row.embedding_dimensions) === queryBatch.dimensions
        const candidate = decodeVector(canUsePrimary ? row.embedding : row.local_embedding)
        const score = cosineSimilarity(canUsePrimary ? queryVector : localQueryVector, candidate)
        if (!Number.isFinite(score) || score < minimumScore) return null
        return searchHitFromRow(row, score)
      })
      .filter((row): row is KnowledgeSearchHit => row !== null)
      .sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId) || left.ordinal - right.ordinal)
      .slice(0, topK)
  }

  async close(): Promise<void> {
    await this.waitForMutations()
    if (this.closed) return
    this.database.close()
    this.closed = true
  }

  /** vec0 距离检索；扩展不可用、维度不符或无索引行时返回 null（走回退路径）。 */
  private vecSearch(queryVector: readonly number[], limit: number): Array<{ chunkId: string; distance: number }> | null {
    if (!this.vecAvailable || this.vecDimensions !== queryVector.length) return null
    try {
      const rows = this.all<{ chunk_id: string; distance: number }>(`
        SELECT chunk_id, distance
        FROM knowledge_vec
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `, [encodeVector(queryVector), limit])
      return rows.map((row) => ({ chunkId: row.chunk_id, distance: Number(row.distance) }))
    } catch {
      this.vecAvailable = false
      return null
    }
  }

  /** vec 命中行补全文档信息并按余弦分数归一（distance → similarity）。 */
  private hydrateHits(
    hits: Array<{ chunkId: string; distance: number }>,
    model: string,
    dimensions: number,
    knowledgeBaseId: string | undefined,
    minimumScore: number,
    queryVector: readonly number[]
  ): KnowledgeSearchHit[] {
    if (hits.length === 0) return []
    const placeholders = hits.map(() => '?').join(', ')
    const rows = this.all<ChunkSearchRow>(`
      SELECT c.id, c.document_id, c.knowledge_base_id, c.ordinal, c.content,
        c.start_character, c.end_character, c.embedding, c.local_embedding,
        d.embedding_model, d.embedding_dimensions, d.source, d.display_name,
        d.source_type, d.metadata_json
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.id IN (${placeholders}) AND d.status = 'indexed'
    `, hits.map((hit) => hit.chunkId))
    const distanceById = new Map(hits.map((hit) => [hit.chunkId, hit.distance]))
    return rows
      .filter((row) => !knowledgeBaseId || row.knowledge_base_id === knowledgeBaseId)
      .filter((row) => row.embedding_model === model && numberValue(row.embedding_dimensions) === dimensions)
      .map((row) => {
        const distance = distanceById.get(row.id)
        // vec0 默认 L2 距离；与余弦语义对齐用主向量重算分数
        const score = cosineSimilarity(queryVector, decodeVector(row.embedding))
        void distance
        return Number.isFinite(score) && score >= minimumScore ? searchHitFromRow(row, score) : null
      })
      .filter((row): row is KnowledgeSearchHit => row !== null)
      .sort((left, right) => right.score - left.score)
  }

  /** 判断所有已索引 chunk 是否都已进入 vec 索引（决定 vec-only 结果是否可信）。 */
  private vecCoversAllChunks(): boolean {
    try {
      const row = this.get<{ total: number; indexed: number }>(`
        SELECT
          (SELECT COUNT(*) FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.status = 'indexed') AS total,
          (SELECT COUNT(*) FROM knowledge_vec) AS indexed
      `)
      return Boolean(row && numberValue(row.indexed) >= numberValue(row.total) && numberValue(row.total) > 0)
    } catch {
      return false
    }
  }

  private async indexExtracted(options: {
    knowledgeBaseId: string
    source: string
    extracted: ExtractedDocument
    signal?: AbortSignal
    documentId?: string
    createdAt?: number
    force?: boolean
  }): Promise<KnowledgeDocumentRecord> {
    const content = requiredText(options.extracted.content, '文档正文', 512 * 1024 * 1024)
    const displayName = requiredText(options.extracted.displayName, '文档名称', 500)
    const contentHash = createHash('sha256').update(content).digest('hex')
    const metadataJson = JSON.stringify(options.extracted.metadata)
    const existing = options.documentId
      ? this.get<DocumentRow>('SELECT * FROM knowledge_documents WHERE id = ?', [options.documentId])
      : this.get<DocumentRow>('SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? AND source = ?', [options.knowledgeBaseId, options.source])
    if (existing && !options.force && existing.status === 'indexed' && existing.content_hash === contentHash) return documentRecord(existing)

    const identity: DocumentIdentity = {
      id: options.documentId ?? existing?.id ?? this.idFactory(),
      createdAt: options.createdAt ?? (existing ? numberValue(existing.created_at) : this.now())
    }
    await this.withMutation(async () => {
      const timestamp = this.now()
      this.run(`
        INSERT INTO knowledge_documents (
          id, knowledge_base_id, source_type, source, display_name, status, error,
          content_hash, extracted_text, chunk_count, embedding_model,
          embedding_dimensions, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'processing', NULL, ?, ?, 0, '', 0, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          knowledge_base_id = excluded.knowledge_base_id,
          source_type = excluded.source_type,
          source = excluded.source,
          display_name = excluded.display_name,
          status = 'processing', error = NULL,
          content_hash = excluded.content_hash,
          extracted_text = excluded.extracted_text,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `, [
        identity.id,
        options.knowledgeBaseId,
        options.extracted.sourceType,
        options.source,
        displayName,
        contentHash,
        content,
        metadataJson,
        identity.createdAt,
        timestamp
      ])
      this.touchKnowledgeBase(options.knowledgeBaseId, timestamp)
    })

    try {
      if (options.signal?.aborted) throw abortError(options.signal.reason)
      const chunks = chunkText(content, this.chunking)
      if (!chunks.length) throw new Error('文档分块结果为空')
      const batch = await this.embeddingProvider.embed(chunks.map((chunk) => chunk.content), options.signal)
      if (batch.vectors.length !== chunks.length) throw new Error('embedding 数量与文档分块数量不匹配')
      const localVectors = chunks.map((chunk) => localFeatureHashEmbedding(chunk.content, this.localFallbackDimensions))
      await this.withMutation(async () => {
        const timestamp = this.now()
        this.run('BEGIN IMMEDIATE')
        try {
          this.run('DELETE FROM knowledge_chunks WHERE document_id = ?', [identity.id])
          if (this.vecAvailable && this.vecDimensions !== null) this.run('DELETE FROM knowledge_vec WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)', [identity.id])
          for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index]
            const chunkId = this.idFactory()
            this.run(`
              INSERT INTO knowledge_chunks (
                id, document_id, knowledge_base_id, ordinal, content,
                start_character, end_character, embedding, local_embedding
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              chunkId,
              identity.id,
              options.knowledgeBaseId,
              chunk.ordinal,
              chunk.content,
              chunk.startCharacter,
              chunk.endCharacter,
              encodeVector(batch.vectors[index]),
              encodeVector(localVectors[index])
            ])
            this.insertVecRow(chunkId, batch.vectors[index])
          }
          this.run(`
            UPDATE knowledge_documents
            SET status = 'indexed', error = NULL, chunk_count = ?, embedding_model = ?,
              embedding_dimensions = ?, updated_at = ?
            WHERE id = ?
          `, [chunks.length, batch.model, batch.dimensions, timestamp, identity.id])
          this.touchKnowledgeBase(options.knowledgeBaseId, timestamp)
          this.run('COMMIT')
        } catch (error) {
          this.run('ROLLBACK')
          throw error
        }
      })
    } catch (error) {
      await this.withMutation(async () => {
        const message = boundedText(errorMessage(error), '索引错误', 4_000)
        this.run("UPDATE knowledge_documents SET status = 'failed', error = ?, chunk_count = 0, updated_at = ? WHERE id = ?", [
          message,
          this.now(),
          identity.id
        ])
        this.run('DELETE FROM knowledge_chunks WHERE document_id = ?', [identity.id])
        if (this.vecAvailable) this.run('DELETE FROM knowledge_vec WHERE chunk_id NOT IN (SELECT id FROM knowledge_chunks)')
      })
      throw error
    }
    const indexed = this.get<DocumentRow>('SELECT * FROM knowledge_documents WHERE id = ?', [identity.id])
    if (!indexed) throw new Error('知识库索引完成后未找到文档记录')
    return documentRecord(indexed)
  }

  /** 将主向量写入 vec0 索引；维度变化时重建整张虚拟表，失败时降级为不可用。 */
  private insertVecRow(chunkId: string, vector: readonly number[]): void {
    if (!this.vecAvailable) return
    try {
      if (this.vecDimensions !== vector.length) {
        this.run('DROP TABLE IF EXISTS knowledge_vec')
        this.run(`CREATE VIRTUAL TABLE knowledge_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${vector.length}])`)
        this.vecDimensions = vector.length
        // 维度变化后按新维度回填其余 chunk 的主向量
        const rows = this.all<{ id: string; embedding: Buffer }>('SELECT id, embedding FROM knowledge_chunks')
        for (const row of rows) {
          const candidate = decodeVector(row.embedding)
          if (candidate.length === vector.length && row.id !== chunkId) {
            this.run('INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)', [row.id, encodeVector(candidate)])
          }
        }
      }
      this.run('INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)', [chunkId, encodeVector(vector)])
    } catch {
      this.vecAvailable = false
      try { this.run('DROP TABLE IF EXISTS knowledge_vec') } catch { /* 降级后由 JS 余弦接管 */ }
      this.vecDimensions = null
    }
  }

  private migrate(): void {
    this.database.pragma('foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        knowledge_base_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        content_hash TEXT NOT NULL,
        extracted_text TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT NOT NULL DEFAULT '',
        embedding_dimensions INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        UNIQUE (knowledge_base_id, source)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_base ON knowledge_documents(knowledge_base_id, updated_at);
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        knowledge_base_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        content TEXT NOT NULL,
        start_character INTEGER NOT NULL,
        end_character INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        local_embedding BLOB NOT NULL,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        UNIQUE (document_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_base ON knowledge_chunks(knowledge_base_id, document_id, ordinal);
    `)
    try {
      sqliteVec.load(this.database)
      this.vecAvailable = true
      const existing = this.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_vec'")
      if (existing) {
        try {
          const probe = this.all<{ embedding_dims?: number }>('SELECT embedding_dims FROM knowledge_vec LIMIT 1')
          if (probe[0]?.embedding_dims) this.vecDimensions = Number(probe[0].embedding_dims)
        } catch {
          // 无法探测维度时留待首次插入重建
        }
      }
    } catch {
      this.vecAvailable = false
    }
  }

  private ensureKnowledgeBaseExists(id: string): void {
    this.ensureOpen()
    if (!this.get<{ id: string }>('SELECT id FROM knowledge_bases WHERE id = ?', [id])) throw new Error(`知识库不存在: ${id}`)
  }

  private touchKnowledgeBase(id: string, timestamp = this.now()): void {
    this.run('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [timestamp, id])
  }

  private run(sql: string, params: SqlParam[] = []): void {
    this.ensureOpen()
    this.database.prepare(sql).run(...params)
  }

  private all<T>(sql: string, params: SqlParam[] = []): T[] {
    this.ensureOpen()
    return this.database.prepare(sql).all(...params) as T[]
  }

  private get<T>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureOpen()
    const pending = this.mutation.then(operation, operation)
    this.mutation = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async waitForMutations(): Promise<void> {
    await this.mutation
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('知识库已关闭')
  }
}

type SqlParam = string | number | bigint | Buffer | null

interface DocumentRow {
  id: string
  knowledge_base_id: string
  source_type: KnowledgeSourceType
  source: string
  display_name: string
  status: 'processing' | 'indexed' | 'failed'
  error?: string | null
  content_hash: string
  extracted_text: string
  chunk_count: number
  embedding_model: string
  embedding_dimensions: number
  metadata_json: string
  created_at: number
  updated_at: number
}

function searchHitFromRow(row: ChunkSearchRow, score: number): KnowledgeSearchHit {
  return {
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id,
    ordinal: numberValue(row.ordinal),
    content: row.content,
    startCharacter: numberValue(row.start_character),
    endCharacter: numberValue(row.end_character),
    score,
    source: row.source,
    displayName: row.display_name,
    sourceType: row.source_type,
    metadata: parseMetadata(row.metadata_json)
  }
}

function documentRecord(row: DocumentRow): KnowledgeDocumentRecord {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    sourceType: row.source_type,
    source: row.source,
    displayName: row.display_name,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    contentHash: row.content_hash,
    chunkCount: numberValue(row.chunk_count),
    embeddingModel: row.embedding_model,
    embeddingDimensions: numberValue(row.embedding_dimensions),
    metadata: parseMetadata(row.metadata_json),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at)
  }
}

function parseMetadata(value: string): Record<string, string | number | boolean | null> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string | number | boolean | null> = {}
    for (const [key, item] of Object.entries(parsed)) {
      if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') result[key] = item
    }
    return result
  } catch {
    return {}
  }
}

function encodeVector(vector: readonly number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT)
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT))
  return buffer
}

function decodeVector(value: Buffer | Uint8Array): number[] {
  const bytes = Buffer.from(value)
  if (bytes.length % Float32Array.BYTES_PER_ELEMENT !== 0) return []
  const result: number[] = []
  for (let offset = 0; offset < bytes.length; offset += Float32Array.BYTES_PER_ELEMENT) result.push(bytes.readFloatLE(offset))
  return result
}

function isEmbeddingProvider(value: EmbeddingConfig | EmbeddingProvider | undefined): value is EmbeddingProvider {
  return Boolean(value && typeof (value as EmbeddingProvider).embed === 'function')
}

function normalizedHttpUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('网页导入仅允许 HTTP(S) URL')
  parsed.hash = ''
  return parsed.toString()
}

function requiredText(value: string, label: string, maximumLength: number): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  return boundedText(normalized, label, maximumLength)
}

function boundedText(value: string, label: string, maximumLength: number): string {
  if (value.length > maximumLength) throw new Error(`${label}超过长度上限（${maximumLength} 字符）`)
  return value
}

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`数值必须是 ${minimum} 到 ${maximum} 之间的整数`)
  return value
}

function finiteOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`数值必须在 ${minimum} 到 ${maximum} 之间`)
  return value
}

function numberValue(value: number): number {
  return Number(value) || 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}
