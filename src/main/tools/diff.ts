/**
 * 行级 unified diff 生成器（纯函数，供 Edit/Write 工具与测试使用）。
 * 采用 LCS 对齐，输出带 @@ 头的 hunk 文本；上下文行数与总行数受上限约束。
 */

const DEFAULT_CONTEXT = 3
/** diff 最长输出行数，超过后截断并附加提示，防止巨型重写刷屏。 */
const MAX_DIFF_LINES = 400
/** LCS 表可能超大：任一侧超过该行数时退化为“整段替换”单 hunk。 */
const MAX_LCS_INPUT = 5000

interface DiffLine {
  type: 'context' | 'add' | 'remove'
  text: string
}

interface Hunk {
  beforeStart: number
  beforeCount: number
  afterStart: number
  afterCount: number
  lines: DiffLine[]
}

/** 计算两段文本的行级 unified diff（不含 ---/+++ 文件头）。 */
export function unifiedDiff(before: string, after: string, context = DEFAULT_CONTEXT): string {
  const hunks = buildHunks(diffLines(toLines(before), toLines(after)), context)
  const lines: string[] = []
  for (const hunk of hunks) {
    const header = `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`
    const body = hunk.lines.map((line) => (line.type === 'context' ? ' ' : line.type === 'add' ? '+' : '-') + line.text)
    if (lines.length + body.length + 1 > MAX_DIFF_LINES) {
      const remaining = Math.max(0, MAX_DIFF_LINES - lines.length - 1)
      return [...lines, header, ...body.slice(0, remaining), '（diff 超过展示上限，已截断）'].join('\n')
    }
    lines.push(header, ...body)
  }
  return lines.join('\n')
}

/** 按行切分；末尾换行符只表示行结束，不产生额外的空行。 */
function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffLines(before: string[], after: string[]): DiffLine[] {
  if (before.length > MAX_LCS_INPUT || after.length > MAX_LCS_INPUT) {
    return [
      ...before.map((text): DiffLine => ({ type: 'remove', text })),
      ...after.map((text): DiffLine => ({ type: 'add', text }))
    ]
  }
  const rows = before.length
  const cols = after.length
  // lcs[i][j] = before[i..] 与 after[j..] 的最长公共子序列长度
  const lcs: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const ops: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      ops.push({ type: 'context', text: before[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'remove', text: before[i] })
      i += 1
    } else {
      ops.push({ type: 'add', text: after[j] })
      j += 1
    }
  }
  while (i < rows) { ops.push({ type: 'remove', text: before[i] }); i += 1 }
  while (j < cols) { ops.push({ type: 'add', text: after[j] }); j += 1 }
  return ops
}

/** 把连续操作切分为带上下文的 hunk；无变更时返回空数组。相邻变更（间隔 ≤ 2×context）合并为一个 hunk。 */
function buildHunks(ops: DiffLine[], context: number): Hunk[] {
  const changeIndices = ops.flatMap((op, index) => (op.type === 'context' ? [] : [index]))
  if (changeIndices.length === 0) return []
  const clusters: Array<[number, number]> = []
  for (const index of changeIndices) {
    const last = clusters[clusters.length - 1]
    if (last && index - last[1] <= context * 2) last[1] = index
    else clusters.push([index, index])
  }
  return clusters.map(([firstChange, lastChange]) => {
    const start = Math.max(0, firstChange - context)
    const end = Math.min(ops.length - 1, lastChange + context)
    const lines = ops.slice(start, end + 1)
    const prefix = ops.slice(0, start)
    const beforeOffset = prefix.filter((op) => op.type !== 'add').length
    const afterOffset = prefix.filter((op) => op.type !== 'remove').length
    const beforeCount = lines.filter((op) => op.type !== 'add').length
    const afterCount = lines.filter((op) => op.type !== 'remove').length
    return {
      // unified diff 约定：空范围（纯插入/纯删除一侧）行号从 0 计
      beforeStart: beforeCount === 0 ? beforeOffset : beforeOffset + 1,
      beforeCount,
      afterStart: afterCount === 0 ? afterOffset : afterOffset + 1,
      afterCount,
      lines
    }
  })
}
