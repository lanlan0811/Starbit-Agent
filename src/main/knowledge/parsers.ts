import { inflateRawSync, inflateSync } from 'node:zlib'
import { basename, extname, resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { ExtractedDocument, KnowledgeSourceType } from './types'

export interface DocumentParserOptions {
  maxFileBytes?: number
  maxExpandedBytes?: number
  fetchTimeoutMs?: number
  fetch?: typeof globalThis.fetch
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_EXPANDED_BYTES = 128 * 1024 * 1024
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/** 读取并提取支持格式；不会执行文档内宏、脚本或外部资源。 */
export async function extractDocumentFromFile(path: string, options: DocumentParserOptions = {}): Promise<ExtractedDocument> {
  const target = resolve(path)
  const fileStat = await stat(target)
  if (!fileStat.isFile()) throw new Error(`知识库导入目标不是文件: ${target}`)
  const maxFileBytes = boundedInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1, 1024 * 1024 * 1024)
  if (fileStat.size > maxFileBytes) throw new Error(`文档超过导入上限（${maxFileBytes} 字节）`)
  const data = await readFile(target)
  const extension = extname(target).toLowerCase()
  const displayName = basename(target)
  const metadata: ExtractedDocument['metadata'] = { byteLength: data.byteLength }

  switch (extension) {
    case '.md':
    case '.markdown':
      return { content: decodeUtf8(data), sourceType: 'markdown', displayName, metadata }
    case '.txt':
      return { content: decodeUtf8(data), sourceType: 'text', displayName, metadata }
    case '.html':
    case '.htm': {
      const html = decodeUtf8(data)
      const title = htmlTitle(html)
      return { content: htmlToMarkdown(html), sourceType: 'html', displayName, metadata: { ...metadata, ...(title ? { title } : {}) } }
    }
    case '.pdf':
      return {
        content: extractPdfText(data, boundedInteger(options.maxExpandedBytes, DEFAULT_MAX_EXPANDED_BYTES, 1, 1024 * 1024 * 1024)),
        sourceType: 'pdf',
        displayName,
        metadata
      }
    case '.docx':
      return {
        content: extractDocxText(data, boundedInteger(options.maxExpandedBytes, DEFAULT_MAX_EXPANDED_BYTES, 1, 1024 * 1024 * 1024)),
        sourceType: 'docx',
        displayName,
        metadata
      }
    default:
      throw new Error(`不支持的知识库文档格式: ${extension || '无扩展名'}`)
  }
}

/** 导入网页正文；仅允许 HTTP(S)，不执行页面脚本。 */
export async function extractDocumentFromUrl(url: string, options: DocumentParserOptions = {}, signal?: AbortSignal): Promise<ExtractedDocument> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('网页导入仅允许 HTTP(S) URL')
  const maxFileBytes = boundedInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1, 1024 * 1024 * 1024)
  const timeoutMs = boundedInteger(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS, 100, 600_000)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`网页导入超过 ${timeoutMs}ms`)), timeoutMs)
  const onAbort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetchImpl(parsed, {
      headers: { accept: 'text/html, text/plain, text/markdown, application/pdf;q=0.8, */*;q=0.1' },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`网页导入失败（HTTP ${response.status}）`)
    const announcedSize = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(announcedSize) && announcedSize > maxFileBytes) throw new Error(`网页内容超过导入上限（${maxFileBytes} 字节）`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.byteLength > maxFileBytes) throw new Error(`网页内容超过导入上限（${maxFileBytes} 字节）`)
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    const finalUrl = response.url || parsed.toString()
    let content: string
    if (contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf')) {
      content = extractPdfText(data, boundedInteger(options.maxExpandedBytes, DEFAULT_MAX_EXPANDED_BYTES, 1, 1024 * 1024 * 1024))
    } else if (contentType.includes('text/markdown') || /\.md(?:own)?$/i.test(parsed.pathname)) {
      content = decodeUtf8(data)
    } else if (contentType.includes('text/plain')) {
      content = decodeUtf8(data)
    } else {
      content = htmlToMarkdown(decodeUtf8(data))
    }
    const title = contentType.includes('html') ? htmlTitle(decodeUtf8(data)) : ''
    return {
      content,
      sourceType: 'url',
      displayName: title || parsed.hostname,
      metadata: {
        url: finalUrl,
        contentType: contentType || 'application/octet-stream',
        byteLength: data.byteLength,
        ...(title ? { title } : {})
      }
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function htmlToMarkdown(html: string): string {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  value = value.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, href: string, label: string) => {
    const text = stripTags(label).trim()
    return text ? `[${text}](${decodeHtmlEntities(href)})` : ''
  })
  for (let level = 6; level >= 1; level -= 1) {
    const expression = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}\\s*>`, 'gi')
    value = value.replace(expression, (_match, content: string) => `\n${'#'.repeat(level)} ${stripTags(content).trim()}\n`)
  }
  value = value
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|ul|ol|li|table|tr|blockquote|pre)\s*>/gi, '\n')
    .replace(/<(p|div|section|article|header|footer|main|aside|nav|ul|ol|table|tr|blockquote|pre)\b[^>]*>/gi, '\n')
  return normalizeExtractedText(decodeHtmlEntities(stripTags(value)))
}

/**
 * 无执行依赖的 DOCX 文本提取器。它只读取 ZIP 中的 Word XML，不释放文件，
 * 并对压缩后大小设置上限以避免 zip bomb。
 */
export function extractDocxText(data: Buffer, maxExpandedBytes = DEFAULT_MAX_EXPANDED_BYTES): string {
  const entries = readZipEntries(data, maxExpandedBytes)
  const documentXml = entries.get('word/document.xml')
  if (!documentXml) throw new Error('DOCX 缺少 word/document.xml')
  const parts = [documentXml]
  for (const [name, value] of entries) {
    if (/^word\/(?:header|footer)\d+\.xml$/i.test(name)) parts.push(value)
  }
  const text = parts
    .map((part) => xmlWordText(part.toString('utf8')))
    .filter(Boolean)
    .join('\n\n')
  if (!text.trim()) throw new Error('DOCX 中没有可提取的文本')
  return normalizeExtractedText(text)
}

/**
 * 轻量 PDF 文本提取：支持常见明文/Flate 内容流、Tj/TJ 与 ToUnicode CMap。
 * 加密或纯扫描 PDF 会明确失败，调用方可在文档状态中呈现并重试 OCR 流程。
 */
export function extractPdfText(data: Buffer, maxExpandedBytes = DEFAULT_MAX_EXPANDED_BYTES): string {
  if (!data.subarray(0, 8).toString('latin1').startsWith('%PDF-')) throw new Error('PDF 文件头无效')
  const source = data.toString('latin1')
  if (/\/Encrypt\b/.test(source)) throw new Error('暂不支持加密 PDF')
  const streams = pdfStreams(data, maxExpandedBytes)
  const allSources = [source, ...streams.map((stream) => stream.toString('latin1'))]
  const characterMap = parsePdfCharacterMap(allSources.join('\n'))
  const fragments: string[] = []
  for (const content of allSources) {
    const blocks = content.match(/BT[\s\S]*?ET/g) ?? []
    for (const block of blocks) {
      const values = scanPdfTextValues(block)
      const decoded = values
        .map((value) => decodePdfText(value, characterMap))
        .map((value) => value.trim())
        .filter(Boolean)
      if (decoded.length) fragments.push(decoded.join(' '))
    }
  }
  const unique = fragments.filter((fragment, index) => fragment !== fragments[index - 1])
  const text = normalizeExtractedText(unique.join('\n'))
  if (!text) throw new Error('PDF 中没有可提取文本；文件可能是纯扫描件')
  return text
}

function readZipEntries(data: Buffer, maxExpandedBytes: number): Map<string, Buffer> {
  const endOffset = findZipEndRecord(data)
  if (endOffset < 0) throw new Error('DOCX ZIP 目录无效')
  const entryCount = data.readUInt16LE(endOffset + 10)
  let cursor = data.readUInt32LE(endOffset + 16)
  let expandedBytes = 0
  const result = new Map<string, Buffer>()
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('DOCX ZIP 中央目录损坏')
    const method = data.readUInt16LE(cursor + 10)
    const compressedSize = data.readUInt32LE(cursor + 20)
    const uncompressedSize = data.readUInt32LE(cursor + 24)
    const fileNameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const localOffset = data.readUInt32LE(cursor + 42)
    const nameEnd = cursor + 46 + fileNameLength
    if (nameEnd > data.length) throw new Error('DOCX ZIP 文件名越界')
    const name = data.subarray(cursor + 46, nameEnd).toString('utf8').replace(/\\/g, '/')
    cursor = nameEnd + extraLength + commentLength
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(name)) continue
    if (expandedBytes + uncompressedSize > maxExpandedBytes) throw new Error(`DOCX 解压内容超过上限（${maxExpandedBytes} 字节）`)
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('DOCX ZIP 本地目录损坏')
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const bodyStart = localOffset + 30 + localNameLength + localExtraLength
    const bodyEnd = bodyStart + compressedSize
    if (bodyEnd > data.length) throw new Error('DOCX ZIP 数据越界')
    const compressed = data.subarray(bodyStart, bodyEnd)
    let expanded: Buffer
    if (method === 0) expanded = Buffer.from(compressed)
    else if (method === 8) expanded = inflateRawSync(compressed, { maxOutputLength: maxExpandedBytes - expandedBytes })
    else throw new Error(`DOCX 使用了不支持的 ZIP 压缩算法: ${method}`)
    if (expanded.length !== uncompressedSize) throw new Error(`DOCX ZIP 条目大小不匹配: ${name}`)
    expandedBytes += expanded.length
    result.set(name, expanded)
  }
  return result
}

function findZipEndRecord(data: Buffer): number {
  const minimum = Math.max(0, data.length - 65_557)
  for (let cursor = data.length - 22; cursor >= minimum; cursor -= 1) {
    if (data.readUInt32LE(cursor) === 0x06054b50) return cursor
  }
  return -1
}

function xmlWordText(xml: string): string {
  return decodeHtmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
      .replace(/<\/w:p\s*>/gi, '\n')
      .replace(/<\/w:tr\s*>/gi, '\n')
      .replace(/<\/w:tc\s*>/gi, '\t')
      .replace(/<[^>]+>/g, '')
  )
}

function pdfStreams(data: Buffer, maxExpandedBytes: number): Buffer[] {
  const source = data.toString('latin1')
  const marker = /stream(?:\r\n|\n|\r)/g
  const streams: Buffer[] = []
  let expandedBytes = 0
  let match: RegExpExecArray | null
  while ((match = marker.exec(source))) {
    const start = marker.lastIndex
    const end = source.indexOf('endstream', start)
    if (end < 0) break
    let bodyEnd = end
    while (bodyEnd > start && (source[bodyEnd - 1] === '\r' || source[bodyEnd - 1] === '\n')) bodyEnd -= 1
    const dictionaryStart = source.lastIndexOf('<<', match.index)
    const dictionary = dictionaryStart >= 0 ? source.slice(dictionaryStart, match.index) : ''
    const raw = data.subarray(start, bodyEnd)
    try {
      const decoded = /\/FlateDecode\b/.test(dictionary) ? inflateSync(raw, { maxOutputLength: maxExpandedBytes - expandedBytes }) : Buffer.from(raw)
      if (expandedBytes + decoded.length > maxExpandedBytes) throw new Error(`PDF 解压内容超过上限（${maxExpandedBytes} 字节）`)
      expandedBytes += decoded.length
      streams.push(decoded)
    } catch (error) {
      if (error instanceof Error && error.message.includes('超过上限')) throw error
      // 图片流或暂不支持的过滤器不影响其余文本流提取。
    }
    marker.lastIndex = end + 'endstream'.length
  }
  return streams
}

type PdfTextValue = { kind: 'literal'; value: string } | { kind: 'hex'; value: string }

function scanPdfTextValues(block: string): PdfTextValue[] {
  const values: PdfTextValue[] = []
  let cursor = 0
  while (cursor < block.length) {
    const character = block[cursor]
    if (character === '(') {
      let depth = 1
      let value = ''
      cursor += 1
      while (cursor < block.length && depth > 0) {
        const current = block[cursor]
        if (current === '\\') {
          value += current
          cursor += 1
          if (cursor < block.length) value += block[cursor]
        } else if (current === '(') {
          depth += 1
          value += current
        } else if (current === ')') {
          depth -= 1
          if (depth > 0) value += current
        } else {
          value += current
        }
        cursor += 1
      }
      values.push({ kind: 'literal', value })
      continue
    }
    if (character === '<' && block[cursor + 1] !== '<') {
      const end = block.indexOf('>', cursor + 1)
      if (end > cursor) {
        const value = block.slice(cursor + 1, end).replace(/\s/g, '')
        if (/^[0-9a-f]*$/i.test(value)) values.push({ kind: 'hex', value })
        cursor = end + 1
        continue
      }
    }
    cursor += 1
  }
  return values
}

function decodePdfText(value: PdfTextValue, characterMap: Map<string, string>): string {
  const bytes = value.kind === 'hex' ? Buffer.from(value.value.length % 2 ? `${value.value}0` : value.value, 'hex') : decodePdfLiteral(value.value)
  if (characterMap.size) {
    const hex = bytes.toString('hex').toUpperCase()
    const widths = [...new Set([...characterMap.keys()].map((key) => key.length))].sort((left, right) => right - left)
    let cursor = 0
    let mapped = ''
    while (cursor < hex.length) {
      const width = widths.find((candidate) => characterMap.has(hex.slice(cursor, cursor + candidate)))
      if (!width) {
        mapped = ''
        break
      }
      mapped += characterMap.get(hex.slice(cursor, cursor + width))
      cursor += width
    }
    if (mapped) return mapped
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16Be(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  const evenZeros = bytes.filter((byte, index) => index % 2 === 0 && byte === 0).length
  if (bytes.length >= 4 && evenZeros >= bytes.length / 4) return decodeUtf16Be(bytes)
  return bytes.toString('latin1')
}

function decodePdfLiteral(value: string): Buffer {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index) & 0xff
    if (code !== 0x5c) {
      bytes.push(code)
      continue
    }
    index += 1
    if (index >= value.length) break
    const escaped = value[index]
    const named: Record<string, number> = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c, '(': 0x28, ')': 0x29, '\\': 0x5c }
    if (escaped in named) {
      bytes.push(named[escaped])
      continue
    }
    if (escaped === '\r' || escaped === '\n') {
      if (escaped === '\r' && value[index + 1] === '\n') index += 1
      continue
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] ?? '')) {
        index += 1
        octal += value[index]
      }
      bytes.push(Number.parseInt(octal, 8) & 0xff)
      continue
    }
    bytes.push(value.charCodeAt(index) & 0xff)
  }
  return Buffer.from(bytes)
}

function parsePdfCharacterMap(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const characterBlocks = source.match(/beginbfchar[\s\S]*?endbfchar/g) ?? []
  for (const block of characterBlocks) {
    for (const match of block.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      result.set(match[1].toUpperCase(), decodeUnicodeHex(match[2]))
    }
  }
  const rangeBlocks = source.match(/beginbfrange[\s\S]*?endbfrange/g) ?? []
  for (const block of rangeBlocks) {
    for (const match of block.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const start = Number.parseInt(match[1], 16)
      const end = Number.parseInt(match[2], 16)
      const target = Number.parseInt(match[3], 16)
      const width = match[1].length
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end - start > 65_536) continue
      for (let code = start; code <= end; code += 1) {
        result.set(code.toString(16).toUpperCase().padStart(width, '0'), String.fromCodePoint(target + code - start))
      }
    }
  }
  return result
}

function decodeUnicodeHex(value: string): string {
  const bytes = Buffer.from(value.length % 2 ? `0${value}` : value, 'hex')
  return bytes.length % 2 === 0 ? decodeUtf16Be(bytes) : bytes.toString('utf8')
}

function decodeUtf16Be(value: Buffer): string {
  const swapped = Buffer.alloc(value.length - (value.length % 2))
  for (let index = 0; index + 1 < value.length; index += 2) {
    swapped[index] = value[index + 1]
    swapped[index + 1] = value[index]
  }
  return swapped.toString('utf16le')
}

function decodeUtf8(data: Buffer): string {
  const value = data.toString('utf8').replace(/^\uFEFF/, '')
  if (value.includes('\u0000')) throw new Error('文本文件包含 NUL 字节，无法按 UTF-8 导入')
  return normalizeExtractedText(value)
}

function htmlTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  return match ? decodeHtmlEntities(stripTags(match[1])).replace(/\s+/g, ' ').trim() : ''
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…'
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1].toLowerCase() === 'x'
      const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`数值必须是 ${minimum} 到 ${maximum} 之间的整数`)
  return value
}

export function sourceTypeFromPath(path: string): KnowledgeSourceType {
  const extension = extname(path).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.txt') return 'text'
  if (extension === '.html' || extension === '.htm') return 'html'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.docx') return 'docx'
  throw new Error(`不支持的知识库文档格式: ${extension || '无扩展名'}`)
}
