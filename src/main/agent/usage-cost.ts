import type { ModelPricing } from '@core/models'
import type { UsageModelCostDto } from './manager'

/** 按单价估算单条用量费用（¥）；未配置单价返回 null。 */
export function estimateCost(tokens: { promptTokens: number; cachedTokens: number; outputTokens: number }, pricing?: ModelPricing): number | null {
  if (!pricing) return null
  return (tokens.promptTokens - tokens.cachedTokens) / 1_000_000 * pricing.inputPerMillion
    + tokens.cachedTokens / 1_000_000 * pricing.cachedInputPerMillion
    + tokens.outputTokens / 1_000_000 * pricing.outputPerMillion
}

/** 汇总按模型费用行。 */
export function sumCost(rows: UsageModelCostDto[]): number {
  return rows.reduce((total, row) => total + (row.estimatedCost ?? 0), 0)
}
