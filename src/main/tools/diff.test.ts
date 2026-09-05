import { describe, expect, it } from 'vitest'
import { unifiedDiff } from './diff'

describe('unified diff 生成', () => {
  it('输出带 hunk 头的增删行标记', () => {
    const diff = unifiedDiff('const a = 1\nconst b = 2\n', 'const a = 1\nconst b = 3\n')
    expect(diff).toContain('@@ -1,2 +1,2 @@')
    expect(diff).toContain('-const b = 2')
    expect(diff).toContain('+const b = 3')
    expect(diff).toContain(' const a = 1')
  })

  it('无变更时返回空串', () => {
    expect(unifiedDiff('same', 'same')).toBe('')
    expect(unifiedDiff('', '')).toBe('')
  })

  it('多文件局部修改拆分为独立 hunk', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    const before = lines.join('\n')
    const afterLines = [...lines]
    afterLines[2] = 'line 3 changed'
    afterLines[25] = 'line 26 changed'
    const diff = unifiedDiff(before, afterLines.join('\n'))
    const hunkHeaders = diff.split('\n').filter((line) => line.startsWith('@@'))
    expect(hunkHeaders).toHaveLength(2)
    // 首个 hunk 上边界被文件起点截断
    expect(hunkHeaders[0]).toContain('-1,6')
    expect(hunkHeaders[1]).toContain('-23,7')
  })

  it('新建文件显示全部新增行', () => {
    const diff = unifiedDiff('', 'a\nb\n')
    expect(diff).toBe('@@ -0,0 +1,2 @@\n+a\n+b')
  })

  it('超行数输入退化为整段替换而不是卡死', () => {
    const big = Array.from({ length: 6000 }, (_, i) => `l${i}`).join('\n')
    const diff = unifiedDiff(big, `${big}\none more`)
    expect(diff).toContain('@@')
    expect(diff.length).toBeGreaterThan(0)
  })

  it('超过展示上限时截断并提示', () => {
    const before = Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 300 }, (_, i) => `new ${i}`).join('\n')
    const diff = unifiedDiff(before, after)
    expect(diff).toContain('已截断')
    expect(diff.split('\n').length).toBeLessThanOrEqual(401)
  })

  it('CRLF 输入按行正确对齐', () => {
    const diff = unifiedDiff('a\r\nb', 'a\r\nc')
    expect(diff).toContain('-b')
    expect(diff).toContain('+c')
  })
})
