import { describe, expect, it } from 'vitest'
import { estimateCost, sumCost } from './usage-cost'

describe('用量费用估算', () => {
  it('分别按未命中输入、命中输入与输出计费', () => {
    const cost = estimateCost(
      { promptTokens: 1_000_000, cachedTokens: 800_000, outputTokens: 500_000 },
      { inputPerMillion: 6, cachedInputPerMillion: 1.2, outputPerMillion: 24 }
    )
    // 0.2×6 + 0.8×1.2 + 0.5×24 = 1.2 + 0.96 + 12
    expect(cost).toBeCloseTo(14.16, 6)
  })

  it('未配置单价返回 null', () => {
    expect(estimateCost({ promptTokens: 100, cachedTokens: 0, outputTokens: 10 })).toBeNull()
  })

  it('费用行汇总忽略未定价行', () => {
    expect(sumCost([{ model: 'a', promptTokens: 0, cachedTokens: 0, outputTokens: 0, requests: 1, estimatedCost: 1.5 }, { model: 'b', promptTokens: 0, cachedTokens: 0, outputTokens: 0, requests: 1, estimatedCost: null }])).toBeCloseTo(1.5, 6)
  })
})
