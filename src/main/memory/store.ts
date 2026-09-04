import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { MemoryContext, MemoryEntry, MemoryScope, MemorySearchHit, MemorySource } from './types'

export interface MemoryStoreOptions {
  workspacePath: string
  userHome?: string
  maxEntryCharacters?: number
  maxContextCharacters?: number
  now?: () => number
  idFactory?: () => string
}

interface ParsedEntry extends MemoryEntry {
  start: number
  end: number
}

interface MemoryMetadata {
  id: string
  scope: MemoryScope
  source: MemorySource
  sessionId?: string
  createdAt: number
  updatedAt: number
}

const DEFAULT_MAX_ENTRY_CHARACTERS = 64 * 1024
const DEFAULT_MAX_CONTEXT_CHARACTERS = 256 * 1024
const DOCUMENT_HEADER = '# Starbit 长期记忆\n\n此文件由用户与衔星共同维护，可直接编辑。结构化条目使用 HTML 注释保存元数据。\n'
const START_MARKER = '<!-- starbit-memory:start '
const END_MARKER_PREFIX = '<!-- starbit-memory:end '

/**
 * Markdown 分层记忆。AGENTS.md 只有读取入口，类中不存在写项目规则的方法，
 * 从 API 结构上保证项目规则不会被 memory 工具改写。
 */
export class MemoryStore {
  readonly workspacePath: string
  readonly userMemoryPath: string
  readonly workspaceMemoryPath: string
  readonly projectRulesPath: string

  private readonly maxEntryCharacters: number
  private readonly maxContextCharacters: number
  private readonly now: () => number
  private readonly idFactory: () => string
  private mutation: Promise<unknown> = Promise.resolve()

  constructor(options: MemoryStoreOptions) {
    if (!options.workspacePath.trim()) throw new Error('记忆系统缺少工作区路径')
    this.workspacePath = resolve(options.workspacePath)
    const userHome = resolve(options.userHome ?? homedir())
    this.userMemoryPath = join(userHome, '.starbit', 'memory.md')
    this.workspaceMemoryPath = join(this.workspacePath, 'memory.md')
    this.projectRulesPath = join(this.workspacePath, 'AGENTS.md')
    this.maxEntryCharacters = integerOption(options.maxEntryCharacters, DEFAULT_MAX_ENTRY_CHARACTERS, 1, 4 * 1024 * 1024)
    this.maxContextCharacters = integerOption(options.maxContextCharacters, DEFAULT_MAX_CONTEXT_CHARACTERS, 1, 16 * 1024 * 1024)
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  async list(scope?: MemoryScope): Promise<MemoryEntry[]> {
    await this.mutation
    const scopes: MemoryScope[] = scope ? [scope] : ['workspace', 'user']
    const documents = await Promise.all(scopes.map(async (item) => ({ scope: item, content: await readOptional(this.pathFor(item)) })))
    return documents
      .flatMap(({ scope: itemScope, content }) => parseEntries(content, itemScope))
      .map(stripOffsets)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  }

  async add(scope: MemoryScope, content: string, options: { source?: MemorySource; sessionId?: string } = {}): Promise<MemoryEntry> {
    const normalizedContent = validateContent(content, this.maxEntryCharacters)
    const source = options.source ?? 'manual'
    validateScope(scope)
    validateSource(source)
    const sessionId = normalizeSessionId(options.sessionId)
    if (source === 'session' && !sessionId) throw new Error('会话摘要必须包含 sessionId')
    return this.withMutation(async () => {
      const timestamp = this.now()
      const entry: MemoryEntry = {
        id: safeId(this.idFactory()),
        scope,
        source,
        content: normalizedContent,
        ...(sessionId ? { sessionId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp
      }
      const path = this.pathFor(scope)
      const current = await readOptional(path)
      const separator = current.trim() ? '\n\n' : ''
      const next = `${current.trimEnd() || DOCUMENT_HEADER.trimEnd()}${separator}${serializeEntry(entry)}\n`
      await writeAtomic(path, next)
      return entry
    })
  }

  async update(id: string, content: string): Promise<MemoryEntry> {
    const normalizedId = safeId(id)
    const normalizedContent = validateContent(content, this.maxEntryCharacters)
    return this.withMutation(async () => {
      for (const scope of ['workspace', 'user'] as const) {
        const path = this.pathFor(scope)
        const document = await readOptional(path)
        const entry = parseEntries(document, scope).find((candidate) => candidate.id === normalizedId)
        if (!entry) continue
        if (normalizedContent.includes(endMarker(normalizedId))) throw new Error('记忆内容包含保留结束标记')
        const updated: MemoryEntry = { ...stripOffsets(entry), content: normalizedContent, updatedAt: this.now() }
        const next = `${document.slice(0, entry.start)}${serializeEntry(updated)}${document.slice(entry.end)}`
        await writeAtomic(path, normalizeDocumentEnd(next))
        return updated
      }
      throw new Error(`记忆条目不存在: ${normalizedId}`)
    })
  }

  async delete(id: string): Promise<boolean> {
    const normalizedId = safeId(id)
    return this.withMutation(async () => {
      for (const scope of ['workspace', 'user'] as const) {
        const path = this.pathFor(scope)
        const document = await readOptional(path)
        const entry = parseEntries(document, scope).find((candidate) => candidate.id === normalizedId)
        if (!entry) continue
        const before = document.slice(0, entry.start).trimEnd()
        const after = document.slice(entry.end).trimStart()
        const next = [before, after].filter(Boolean).join('\n\n')
        await writeAtomic(path, normalizeDocumentEnd(next || DOCUMENT_HEADER))
        return true
      }
      return false
    })
  }

  /** 同一会话仅保留一个最新摘要，避免每轮重复堆积。 */
  async saveSessionSummary(sessionId: string, summary: string, scope: MemoryScope = 'workspace'): Promise<MemoryEntry> {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!normalizedSessionId) throw new Error('会话摘要缺少 sessionId')
    const existing = (await this.list(scope)).find((entry) => entry.source === 'session' && entry.sessionId === normalizedSessionId)
    return existing
      ? this.update(existing.id, summary)
      : this.add(scope, summary, { source: 'session', sessionId: normalizedSessionId })
  }

  async search(query: string, options: { scope?: MemoryScope; limit?: number } = {}): Promise<MemorySearchHit[]> {
    const normalizedQuery = query.normalize('NFKC').trim()
    if (!normalizedQuery) throw new Error('记忆检索问题不能为空')
    validateScopeOptional(options.scope)
    const limit = integerOption(options.limit, 10, 1, 100)
    await this.mutation
    const scopes: MemoryScope[] = options.scope ? [options.scope] : ['workspace', 'user']
    const candidates: MemorySearchHit[] = []
    for (const scope of scopes) {
      const path = this.pathFor(scope)
      const document = await readOptional(path)
      const entries = parseEntries(document, scope)
      for (const entry of entries) {
        candidates.push({
          id: entry.id,
          scope,
          source: entry.source,
          content: entry.content,
          score: lexicalScore(normalizedQuery, entry.content),
          path,
          ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
          updatedAt: entry.updatedAt
        })
      }
      const unmanaged = removeManagedEntries(document, entries)
      for (const [index, paragraph] of splitMemoryDocument(unmanaged).entries()) {
        candidates.push({
          id: `document-${scope}-${index}`,
          scope,
          source: 'document',
          content: paragraph,
          score: lexicalScore(normalizedQuery, paragraph),
          path
        })
      }
    }
    return candidates
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.id.localeCompare(right.id))
      .slice(0, limit)
  }

  async readUserMemory(): Promise<string> {
    await this.mutation
    return readOptional(this.userMemoryPath)
  }

  async readWorkspaceMemory(): Promise<string> {
    await this.mutation
    return readOptional(this.workspaceMemoryPath)
  }

  /** AGENTS.md 只读加载；仅当前工作区生效。 */
  async readProjectRules(): Promise<string> {
    await this.mutation
    return readOptional(this.projectRulesPath)
  }

  async loadContext(): Promise<MemoryContext> {
    const [userMemory, workspaceMemory, projectRules] = await Promise.all([
      this.readUserMemory(),
      this.readWorkspaceMemory(),
      this.readProjectRules()
    ])
    const sections = [
      section('用户级长期记忆', userMemory || '当前没有用户级长期记忆。'),
      section('工作区长期记忆', workspaceMemory || '当前没有工作区长期记忆。'),
      section('工作区项目规则（AGENTS.md，只读）', projectRules || '当前工作区没有 AGENTS.md 项目规则。')
    ]
    const systemSection = truncateContext(sections.join('\n\n'), this.maxContextCharacters)
    return { userMemory, workspaceMemory, projectRules, systemSection }
  }

  pathFor(scope: MemoryScope): string {
    validateScope(scope)
    return scope === 'user' ? this.userMemoryPath : this.workspaceMemoryPath
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutation.then(operation, operation)
    this.mutation = pending.then(() => undefined, () => undefined)
    return pending
  }
}

function parseEntries(document: string, expectedScope: MemoryScope): ParsedEntry[] {
  const result: ParsedEntry[] = []
  const startPattern = /<!--[ \t]*starbit-memory:start[ \t]+(\{[^\r\n]*\})[ \t]*-->/g
  let match: RegExpExecArray | null
  while ((match = startPattern.exec(document))) {
    let metadata: MemoryMetadata
    try {
      metadata = validateMetadata(JSON.parse(match[1]) as unknown, expectedScope)
    } catch {
      continue
    }
    const marker = endMarker(metadata.id)
    const markerIndex = document.indexOf(marker, startPattern.lastIndex)
    if (markerIndex < 0) continue
    const content = document.slice(startPattern.lastIndex, markerIndex).replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    const end = markerIndex + marker.length
    result.push({ ...metadata, content, start: match.index, end })
    startPattern.lastIndex = end
  }
  return result
}

function validateMetadata(value: unknown, expectedScope: MemoryScope): MemoryMetadata {
  if (!value || typeof value !== 'object') throw new Error('记忆元数据无效')
  const record = value as Record<string, unknown>
  const id = safeId(String(record.id ?? ''))
  const scope = record.scope
  const source = record.source
  if (scope !== expectedScope) throw new Error('记忆条目 scope 与文件不匹配')
  validateSource(source)
  const createdAt = Number(record.createdAt)
  const updatedAt = Number(record.updatedAt)
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(updatedAt) || createdAt < 0 || updatedAt < createdAt) {
    throw new Error('记忆条目时间无效')
  }
  const sessionId = normalizeSessionId(typeof record.sessionId === 'string' ? record.sessionId : undefined)
  return { id, scope: expectedScope, source, ...(sessionId ? { sessionId } : {}), createdAt, updatedAt }
}

function serializeEntry(entry: MemoryEntry): string {
  const metadata: MemoryMetadata = {
    id: safeId(entry.id),
    scope: entry.scope,
    source: entry.source,
    ...(entry.sessionId ? { sessionId: normalizeSessionId(entry.sessionId) } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }
  return `${START_MARKER}${JSON.stringify(metadata)} -->\n${entry.content}\n${endMarker(entry.id)}`
}

function endMarker(id: string): string {
  return `${END_MARKER_PREFIX}${safeId(id)} -->`
}

function stripOffsets(entry: ParsedEntry): MemoryEntry {
  return {
    id: entry.id,
    scope: entry.scope,
    source: entry.source,
    content: entry.content,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }
}

function removeManagedEntries(document: string, entries: ParsedEntry[]): string {
  let cursor = 0
  const pieces: string[] = []
  for (const entry of entries.sort((left, right) => left.start - right.start)) {
    pieces.push(document.slice(cursor, entry.start))
    cursor = entry.end
  }
  pieces.push(document.slice(cursor))
  return pieces.join('\n')
}

function splitMemoryDocument(document: string): string[] {
  return document
    .replace(/^# Starbit 长期记忆\s*/i, '')
    .replace(/此文件由用户与衔星共同维护，可直接编辑。结构化条目使用 HTML 注释保存元数据。/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function lexicalScore(query: string, content: string): number {
  const queryFeatures = features(query)
  if (!queryFeatures.length) return 0
  const normalizedContent = content.normalize('NFKC').toLocaleLowerCase('zh-CN')
  const contentFeatures = new Set(features(content))
  let matches = 0
  for (const feature of queryFeatures) if (contentFeatures.has(feature)) matches += 1
  const phraseBonus = normalizedContent.includes(query.toLocaleLowerCase('zh-CN')) ? queryFeatures.length : 0
  return (matches + phraseBonus) / (queryFeatures.length * 2)
}

function features(value: string): string[] {
  const words = value.normalize('NFKC').toLocaleLowerCase('zh-CN').match(/[\p{L}\p{N}_-]+/gu) ?? []
  const result = new Set<string>()
  for (const word of words) {
    result.add(word)
    const characters = Array.from(word)
    if (characters.some((character) => /[\u3400-\u9fff]/.test(character))) {
      characters.forEach((character) => result.add(character))
      for (let index = 0; index + 1 < characters.length; index += 1) result.add(`${characters[index]}${characters[index + 1]}`)
    }
  }
  return [...result]
}

async function readOptional(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  } catch (error) {
    if (isMissingFile(error)) return ''
    throw error
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    // Windows 上目标文件被实时索引器短暂占用时，直接覆盖仍可保持数据完整。
    await writeFile(path, content, 'utf8')
    try {
      await rename(temporary, `${temporary}.discarded`)
    } catch {
      // 临时文件清理由应用退出维护任务处理；不以清理失败覆盖主写入结果。
    }
    if (!isRecoverableRenameError(error)) throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT')
}

function isRecoverableRenameError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && ['EEXIST', 'EPERM', 'EACCES'].includes(String((error as { code: unknown }).code)))
}

function validateContent(content: string, maximum: number): string {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new Error('记忆内容不能为空')
  if (normalized.length > maximum) throw new Error(`记忆内容超过上限（${maximum} 字符）`)
  return normalized
}

function safeId(id: string): string {
  const normalized = id.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(normalized)) throw new Error('记忆条目 ID 无效')
  return normalized
}

function normalizeSessionId(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  return safeId(value)
}

function validateScope(scope: unknown): asserts scope is MemoryScope {
  if (scope !== 'user' && scope !== 'workspace') throw new Error('记忆 scope 必须是 user 或 workspace')
}

function validateScopeOptional(scope: unknown): void {
  if (scope !== undefined) validateScope(scope)
}

function validateSource(source: unknown): asserts source is MemorySource {
  if (source !== 'manual' && source !== 'session') throw new Error('记忆 source 必须是 manual 或 session')
}

function normalizeDocumentEnd(content: string): string {
  return `${content.trimEnd()}\n`
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`
}

function truncateContext(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const headSize = Math.floor(maximum * 0.7)
  const tailSize = maximum - headSize
  return `${value.slice(0, headSize)}\n\n[记忆上下文过长，已省略中间内容]\n\n${value.slice(-tailSize)}`
}

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`数值必须是 ${minimum} 到 ${maximum} 之间的整数`)
  return value
}
