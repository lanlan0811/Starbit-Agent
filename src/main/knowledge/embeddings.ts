import { createHash } from 'node:crypto'

export type EmbeddingMode = 'auto' | 'remote' | 'local'

export interface EmbeddingConfig {
  mode?: EmbeddingMode
  /** OpenAI-compatible API 根地址，例如 https://api.openai.com/v1。 */
  baseUrl?: string
  apiKey?: string
  model?: string
  dimensions?: number
  batchSize?: number
  timeoutMs?: number
  headers?: Record<string, string>
  /** 测试或受控网络环境可注入 fetch；配置不会被持久化到知识库。 */
  fetch?: typeof globalThis.fetch
}

export interface EmbeddingBatch {
  vectors: number[][]
  model: string
  dimensions: number
  provider: 'openai-compatible' | 'local'
}

export interface EmbeddingProvider {
  embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingBatch>
}

const DEFAULT_LOCAL_DIMENSIONS = 384
const DEFAULT_BATCH_SIZE = 64
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * OpenAI-compatible embeddings，auto 模式网络失败时会对整批输入回退到
 * 确定性的本地特征哈希，避免同一索引混入不同维度或不同提供方的向量。
 */
export class ConfigurableEmbeddingProvider implements EmbeddingProvider {
  private readonly mode: EmbeddingMode
  private readonly dimensions: number
  private readonly batchSize: number
  private readonly timeoutMs: number

  constructor(private readonly config: EmbeddingConfig = {}) {
    this.mode = config.mode ?? (config.baseUrl && config.model ? 'auto' : 'local')
    this.dimensions = positiveInteger(config.dimensions, DEFAULT_LOCAL_DIMENSIONS, 16, 8192)
    this.batchSize = positiveInteger(config.batchSize, DEFAULT_BATCH_SIZE, 1, 2048)
    this.timeoutMs = positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 600_000)
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingBatch> {
    if (texts.length === 0) {
      return {
        vectors: [],
        model: this.localModelName(),
        dimensions: this.dimensions,
        provider: 'local'
      }
    }
    if (signal?.aborted) throw abortError(signal.reason)
    if (this.mode === 'local') return this.embedLocally(texts)

    try {
      return await this.embedRemotely(texts, signal)
    } catch (error) {
      if (this.mode === 'remote' || signal?.aborted) throw error
      return this.embedLocally(texts)
    }
  }

  private async embedRemotely(texts: string[], signal?: AbortSignal): Promise<EmbeddingBatch> {
    if (!this.config.baseUrl?.trim()) throw new Error('远程 embedding 缺少 baseUrl')
    if (!this.config.model?.trim()) throw new Error('远程 embedding 缺少 model')
    const endpoint = embeddingsEndpoint(this.config.baseUrl)
    const fetchImpl = this.config.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch')

    const vectors: number[][] = []
    let resolvedDimensions = 0
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      if (signal?.aborted) throw abortError(signal.reason)
      const input = texts.slice(offset, offset + this.batchSize)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error(`embedding 请求超过 ${this.timeoutMs}ms`)), this.timeoutMs)
      const onAbort = (): void => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...this.config.headers
        }
        if (this.config.apiKey?.trim() && !hasHeader(headers, 'authorization')) {
          headers.authorization = `Bearer ${this.config.apiKey.trim()}`
        }
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.config.model,
            input,
            ...(this.config.dimensions ? { dimensions: this.config.dimensions } : {})
          }),
          signal: controller.signal
        })
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 1000).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
          throw new Error(`embedding 请求失败（HTTP ${response.status}）${detail ? `: ${detail}` : ''}`)
        }
        const payload = (await response.json()) as unknown
        const batch = parseEmbeddingResponse(payload, input.length)
        const batchDimensions = batch[0]?.length ?? 0
        if (!batchDimensions) throw new Error('embedding 响应为空')
        if (resolvedDimensions && resolvedDimensions !== batchDimensions) throw new Error('embedding 服务跨批次返回了不同维度')
        resolvedDimensions = batchDimensions
        vectors.push(...batch.map(normalizeVector))
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
      }
    }
    return {
      vectors,
      model: this.config.model,
      dimensions: resolvedDimensions,
      provider: 'openai-compatible'
    }
  }

  private embedLocally(texts: string[]): EmbeddingBatch {
    return {
      vectors: texts.map((text) => localFeatureHashEmbedding(text, this.dimensions)),
      model: this.localModelName(),
      dimensions: this.dimensions,
      provider: 'local'
    }
  }

  private localModelName(): string {
    return `starbit-local-feature-hash-v1-${this.dimensions}`
  }
}

/** 确定性、无网络的本地 embedding，适合作为离线与故障降级路径。 */
export function localFeatureHashEmbedding(text: string, dimensions = DEFAULT_LOCAL_DIMENSIONS): number[] {
  const size = positiveInteger(dimensions, DEFAULT_LOCAL_DIMENSIONS, 16, 8192)
  const vector = new Array<number>(size).fill(0)
  const features = lexicalFeatures(text)
  if (features.length === 0) return vector
  for (const feature of features) {
    const digest = createHash('sha256').update(feature).digest()
    const index = digest.readUInt32LE(0) % size
    const sign = (digest[4] & 1) === 0 ? 1 : -1
    const weight = feature.startsWith('w:') ? 2 : feature.startsWith('b:') ? 1.25 : 0.75
    vector[index] += sign * weight
  }
  return normalizeVector(vector)
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NEGATIVE_INFINITY
    dot += a * b
    leftMagnitude += a * a
    rightMagnitude += b * b
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

function lexicalFeatures(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('zh-CN')
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const features: string[] = []
  for (const word of words) {
    features.push(`w:${word}`)
    const characters = Array.from(word)
    if (characters.length === 1) features.push(`c:${word}`)
    for (const character of characters) features.push(`c:${character}`)
    for (let index = 0; index + 1 < characters.length; index += 1) {
      features.push(`b:${characters[index]}${characters[index + 1]}`)
    }
    if (characters.length > 3) {
      for (let index = 0; index + 2 < characters.length; index += 1) {
        features.push(`t:${characters[index]}${characters[index + 1]}${characters[index + 2]}`)
      }
    }
  }
  return features
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  if (!magnitude) return vector.map(() => 0)
  return vector.map((item) => item / magnitude)
}

function embeddingsEndpoint(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('embedding baseUrl 必须使用 HTTP(S)')
  parsed.search = ''
  parsed.hash = ''
  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/embeddings')) {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/embeddings`
  }
  return parsed.toString()
}

function parseEmbeddingResponse(value: unknown, expected: number): number[][] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { data?: unknown }).data)) {
    throw new Error('embedding 响应缺少 data 数组')
  }
  const rows = (value as { data: unknown[] }).data.map((item, position) => {
    if (!item || typeof item !== 'object') throw new Error(`embedding data[${position}] 无效`)
    const record = item as { index?: unknown; embedding?: unknown }
    if (!Array.isArray(record.embedding) || record.embedding.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
      throw new Error(`embedding data[${position}].embedding 无效`)
    }
    return {
      index: typeof record.index === 'number' && Number.isInteger(record.index) ? record.index : position,
      vector: record.embedding as number[]
    }
  })
  rows.sort((left, right) => left.index - right.index)
  if (rows.length !== expected) throw new Error(`embedding 响应数量不匹配：期望 ${expected}，实际 ${rows.length}`)
  const dimensions = rows[0]?.vector.length ?? 0
  if (!dimensions || rows.some((row) => row.vector.length !== dimensions)) throw new Error('embedding 响应维度不一致')
  return rows.map((row) => row.vector)
}

function hasHeader(headers: Record<string, string>, expected: string): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === expected.toLowerCase())
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`数值必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return value
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}
