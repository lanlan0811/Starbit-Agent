import { z } from 'zod'
import type { ModelConfig } from './models'

const jsonValue: z.ZodType<import('./types').JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)
]))
const thinkingLevel = z.object({ params: z.record(jsonValue), promptHint: z.string().max(4000).optional(), boostMaxTokens: z.boolean().optional() }).strict()
const schema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]*$/),
  name: z.string().trim().min(1).max(200), vendor: z.string().trim().min(1).max(200),
  baseURL: z.string().trim().url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  }, '端点必须是 HTTP(S)，且不能包含用户名或密码'),
  custom: z.boolean(), apiShape: z.enum(['chat-completions', 'responses']),
  apiKeyRequired: z.boolean().optional(),
  modalities: z.array(z.enum(['text', 'image', 'video'])).min(1),
  contextWindow: z.number().int().min(256).max(10_000_000),
  maxOutputTokens: z.number().int().min(1).max(10_000_000),
  thinking: z.object({ low: thinkingLevel, high: thinkingLevel, max: thinkingLevel }).strict(),
  forcedThinking: z.boolean(), multimodalThinkingVerified: z.boolean(),
  samplingWhitelist: z.array(z.string()).optional(), usageCachedTokensPath: z.string().optional(),
  usageCacheScope: z.enum(['top', 'nested']).optional(),
  reasoning: z.object({ clearThinking: z.boolean().optional(), keep: z.boolean().optional(), preserveThinking: z.boolean().optional() }).strict().optional(),
  pricing: z.object({
    inputPerMillion: z.number().min(0).max(100000),
    cachedInputPerMillion: z.number().min(0).max(100000),
    outputPerMillion: z.number().min(0).max(100000)
  }).strict().optional(),
  videoStrategy: z.enum(['video_url', 'image-frames']).optional()
}).strict().refine((model) => model.maxOutputTokens < model.contextWindow, '输出上限必须小于上下文窗口')

export function validateModelConfig(value: unknown): ModelConfig {
  return schema.parse(value)
}
