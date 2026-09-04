import type { ChunkingOptions, KnowledgeChunkRecord } from './types'

export interface TextChunk {
  ordinal: number
  content: string
  startCharacter: number
  endCharacter: number
}

const DEFAULT_MAX_CHARACTERS = 1_200
const DEFAULT_OVERLAP_CHARACTERS = 160
const DEFAULT_MINIMUM_CHARACTERS = 240

/**
 * 优先在段落、换行和句末切分，并保留字符偏移与可配置重叠。
 * 对超长无空白文本仍保证单块不超过 maxCharacters。
 */
export function chunkText(text: string, options: ChunkingOptions = {}): TextChunk[] {
  const maxCharacters = integerOption(options.maxCharacters, DEFAULT_MAX_CHARACTERS, 64, 100_000)
  const overlapCharacters = integerOption(options.overlapCharacters, DEFAULT_OVERLAP_CHARACTERS, 0, maxCharacters - 1)
  const minimumCharacters = integerOption(
    options.minimumCharacters,
    Math.min(DEFAULT_MINIMUM_CHARACTERS, maxCharacters),
    1,
    maxCharacters
  )
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return []

  const chunks: TextChunk[] = []
  let start = leadingWhitespaceEnd(normalized, 0)
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + maxCharacters)
    let end = hardEnd
    if (hardEnd < normalized.length) {
      const floor = Math.min(hardEnd, start + minimumCharacters)
      end = preferredBoundary(normalized, floor, hardEnd)
      if (end <= start) end = hardEnd
    }
    const trimmedEnd = trailingWhitespaceStart(normalized, end, start)
    const safeEnd = trimmedEnd > start ? trimmedEnd : end
    const content = normalized.slice(start, safeEnd).trim()
    if (content) {
      const contentStart = start + normalized.slice(start, safeEnd).indexOf(content)
      chunks.push({
        ordinal: chunks.length,
        content,
        startCharacter: contentStart,
        endCharacter: contentStart + content.length
      })
    }
    if (end >= normalized.length) break
    const candidate = Math.max(start + 1, end - overlapCharacters)
    start = leadingWhitespaceEnd(normalized, candidate)
  }
  return chunks
}

export function materializeChunk(
  chunk: TextChunk,
  ids: { id: string; documentId: string; knowledgeBaseId: string }
): KnowledgeChunkRecord {
  return {
    id: ids.id,
    documentId: ids.documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    ordinal: chunk.ordinal,
    content: chunk.content,
    startCharacter: chunk.startCharacter,
    endCharacter: chunk.endCharacter
  }
}

function preferredBoundary(text: string, floor: number, ceiling: number): number {
  const window = text.slice(floor, ceiling)
  const candidates = [
    lastBoundary(window, /\n\n+/g, 2),
    lastBoundary(window, /\n/g, 1),
    lastBoundary(window, /[。！？!?]\s*/g, 0),
    lastBoundary(window, /[；;]\s*/g, 0),
    lastBoundary(window, /\s+/g, 0)
  ]
  const relative = candidates.find((candidate) => candidate > 0)
  return relative ? floor + relative : ceiling
}

function lastBoundary(value: string, expression: RegExp, minimumWidth: number): number {
  let result = -1
  for (const match of value.matchAll(expression)) {
    result = (match.index ?? 0) + Math.max(minimumWidth, match[0].length)
  }
  return result
}

function leadingWhitespaceEnd(value: string, start: number): number {
  let cursor = start
  while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1
  return cursor
}

function trailingWhitespaceStart(value: string, end: number, floor: number): number {
  let cursor = end
  while (cursor > floor && /\s/.test(value[cursor - 1])) cursor -= 1
  return cursor
}

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`分块参数必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return value
}
