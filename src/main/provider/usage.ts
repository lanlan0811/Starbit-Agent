import type { ApiShape, ModelConfig } from '@core/models'
import type { NormalizedUsage } from './types'

type UnknownRecord = Record<string, unknown>

export function normalizeUsage(raw: unknown, model: ModelConfig, apiShape: ApiShape = model.apiShape): NormalizedUsage {
  const usage = asRecord(raw)
  const promptTokens = readNumber(usage, apiShape === 'responses' ? 'input_tokens' : 'prompt_tokens')
  const outputTokens = readNumber(usage, apiShape === 'responses' ? 'output_tokens' : 'completion_tokens')
  const cachedTokens = readCachedTokens(usage, model, apiShape)
  const cacheWriteTokens = readNestedNumber(usage, 'input_tokens_details', 'cache_write_tokens')

  return {
    promptTokens,
    cachedTokens,
    cacheWriteTokens,
    outputTokens,
    hitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0
  }
}

function readCachedTokens(usage: UnknownRecord, model: ModelConfig, apiShape: ApiShape): number {
  if (apiShape === 'responses') {
    return readNestedNumber(usage, 'input_tokens_details', 'cached_tokens')
  }
  if (model.usageCacheScope === 'top' && model.usageCachedTokensPath) {
    return readNumber(usage, model.usageCachedTokensPath)
  }
  if (model.usageCacheScope === 'nested' && model.usageCachedTokensPath) {
    return readNestedNumber(usage, 'prompt_tokens_details', model.usageCachedTokensPath)
  }
  return readNestedNumber(usage, 'prompt_tokens_details', 'cached_tokens')
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function readNumber(record: UnknownRecord, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function readNestedNumber(record: UnknownRecord, parent: string, key: string): number {
  return readNumber(asRecord(record[parent]), key)
}
