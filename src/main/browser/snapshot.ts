interface RareData {
  index?: number[]
  value?: number[]
}

interface SnapshotNodes {
  parentIndex?: number[]
  nodeType?: number[]
  nodeName?: number[]
  nodeValue?: number[]
  attributes?: number[][]
  backendNodeId?: number[]
  isClickable?: RareData
}

interface SnapshotDocument {
  title?: number
  documentURL?: number
  nodes?: SnapshotNodes
  layout?: { nodeIndex?: number[] }
}

export interface DomSnapshotPayload {
  strings?: string[]
  documents?: SnapshotDocument[]
}

export interface MarkdownSnapshot {
  title: string
  url: string
  markdown: string
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 64_000
const MIN_MAX_CHARS = 1_000
const MAX_MAX_CHARS = 200_000
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SUMMARY'])
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK'])

/** 将 CDP DOMSnapshot.captureSnapshot 的扁平结果转为紧凑 Markdown。 */
export function domSnapshotToMarkdown(payload: DomSnapshotPayload, maxChars = DEFAULT_MAX_CHARS): MarkdownSnapshot {
  const strings = payload.strings ?? []
  const document = payload.documents?.[0]
  if (!document?.nodes) return { title: '', url: '', markdown: '', truncated: false }
  const nodes = document.nodes
  const count = Math.max(nodes.nodeName?.length ?? 0, nodes.nodeValue?.length ?? 0)
  const visible = new Set(document.layout?.nodeIndex ?? [])
  const children: number[][] = Array.from({ length: count }, () => [])
  for (let index = 0; index < count; index += 1) {
    const parent = nodes.parentIndex?.[index] ?? -1
    if (parent >= 0 && parent < count) children[parent].push(index)
  }

  const nameAt = (index: number): string => readString(strings, nodes.nodeName?.[index]).toUpperCase()
  const valueAt = (index: number): string => readString(strings, nodes.nodeValue?.[index])
  const attrsAt = (index: number): Record<string, string> => decodeAttributes(strings, nodes.attributes?.[index])
  const textAt = (index: number): string => collectText(index, children, nameAt, valueAt).replace(/\s+/g, ' ').trim()
  const title = readString(strings, document.title)
  const url = readString(strings, document.documentURL)
  const bodyText: string[] = []
  const controls: string[] = []
  const headings: string[] = []
  const clickable = rareIndexes(nodes.isClickable)

  for (let index = 0; index < count; index += 1) {
    const tag = nameAt(index)
    if (!tag || IGNORED_TAGS.has(tag) || (visible.size > 0 && !visible.has(index))) continue
    const text = textAt(index)
    if (/^H[1-6]$/.test(tag) && text) {
      headings.push(`${'#'.repeat(Number(tag[1]))} ${text}`)
      continue
    }
    if (tag === '#TEXT' && valueAt(index).trim()) bodyText.push(valueAt(index).replace(/\s+/g, ' ').trim())
    if (!INTERACTIVE_TAGS.has(tag) && !clickable.has(index)) continue
    const attrs = attrsAt(index)
    const label = text || attrs['aria-label'] || attrs.placeholder || attrs.name || attrs.value || tag.toLowerCase()
    const selector = selectorFor(index, children, nodes.parentIndex ?? [], nameAt, attrsAt)
    const disabled = Object.hasOwn(attrs, 'disabled') ? ' · disabled' : ''
    if (tag === 'A' && attrs.href) controls.push(`- [link] ${label} → ${attrs.href} · \`${selector}\`${disabled}`)
    else controls.push(`- [${tag.toLowerCase()}] ${label} · \`${selector}\`${disabled}`)
  }

  const sections = [
    title ? `# ${title}` : '',
    url ? `来源：${url}` : '',
    headings.length ? headings.join('\n') : '',
    bodyText.length ? `## 页面文本\n\n${deduplicate(bodyText).join(' ')}` : '',
    controls.length ? `## 可交互元素\n\n${deduplicate(controls).join('\n')}` : ''
  ].filter(Boolean)
  const markdown = sections.join('\n\n')
  const limit = Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.trunc(maxChars)))
  return markdown.length > limit
    ? { title, url, markdown: `${markdown.slice(0, limit)}\n\n[页面内容已截断]`, truncated: true }
    : { title, url, markdown, truncated: false }
}

function readString(strings: string[], index: number | undefined): string {
  return typeof index === 'number' && index >= 0 ? strings[index] ?? '' : ''
}

function decodeAttributes(strings: string[], indexes: number[] | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!indexes) return result
  for (let index = 0; index + 1 < indexes.length; index += 2) {
    const name = readString(strings, indexes[index]).toLowerCase()
    if (name) result[name] = readString(strings, indexes[index + 1])
  }
  return result
}

function collectText(
  root: number,
  children: number[][],
  nameAt: (index: number) => string,
  valueAt: (index: number) => string
): string {
  const values: string[] = []
  const queue = [root]
  let visited = 0
  while (queue.length && visited < 2_000) {
    const index = queue.shift()!
    visited += 1
    const tag = nameAt(index)
    if (IGNORED_TAGS.has(tag)) continue
    if (tag === '#TEXT') values.push(valueAt(index))
    else queue.push(...children[index])
  }
  return values.join(' ')
}

function rareIndexes(data: RareData | undefined): Set<number> {
  return new Set(data?.index ?? [])
}

function selectorFor(
  index: number,
  children: number[][],
  parents: number[],
  nameAt: (index: number) => string,
  attrsAt: (index: number) => Record<string, string>
): string {
  const attrs = attrsAt(index)
  if (attrs.id) return `[id=${JSON.stringify(attrs.id)}]`
  const parts: string[] = []
  let current = index
  while (current >= 0 && parts.length < 6) {
    const tag = nameAt(current).toLowerCase()
    if (!tag || tag.startsWith('#')) break
    const currentAttrs = attrsAt(current)
    if (currentAttrs.id) {
      parts.unshift(`[id=${JSON.stringify(currentAttrs.id)}]`)
      break
    }
    const parent = parents[current] ?? -1
    const siblings = parent >= 0 ? children[parent].filter((child) => nameAt(child) === nameAt(current)) : []
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
    parts.unshift(`${tag}${suffix}`)
    current = parent
  }
  return parts.join(' > ') || '*'
}

function deduplicate(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
