import { describe, expect, it } from 'vitest'
import type { ProviderMessage } from '../provider/types'
import { splitSummaryBatches } from './loop'

function message(content: string): ProviderMessage {
  return { role: 'user', content }
}

describe('长历史分批摘要', () => {
  it('按预算切分且每批非空', () => {
    const messages = Array.from({ length: 10 }, (_, i) => message(`第 ${i} 条，内容约两百字符。`.repeat(20)))
    const batches = splitSummaryBatches(messages, 1200)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat()).toEqual(messages)
    for (const batch of batches) expect(batch.length).toBeGreaterThan(0)
  })

  it('单条超预算的消息独立成批不丢内容', () => {
    const big = message('超长单条消息'.repeat(500))
    const batches = splitSummaryBatches([message('短消息'), big, message('另一条短消息')], 100)
    expect(batches).toHaveLength(3)
    expect(batches[1][0]).toBe(big)
  })

  it('空历史与整体低于预算时不切分', () => {
    expect(splitSummaryBatches([], 1000)).toEqual([])
    const small = [message('短'), message('更短')]
    expect(splitSummaryBatches(small, 100_000)).toEqual([small])
  })
})
