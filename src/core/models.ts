import type { JsonValue } from './types'

/**
 * 模型配置 —— 全部走 OpenAI 协议（Chat Completions / Responses 双形态）
 * 每个模型可配置：baseURL / key / 上下文窗口 / 最大输出 / 思考强度三档映射 / 多模态标记
 */

/** 思考强度三档 */
export type ThinkingLevel = 'low' | 'high' | 'max'

/** 模态类型 */
export type Modality = 'text' | 'image' | 'video'

/** 单档思考参数覆盖（按模型可配置，§3.5） */
export interface ThinkingLevelConfig {
  /** 追加到请求体的参数覆盖 */
  params: Record<string, JsonValue>
  /** 软性提示词引导（如强制思考模型的 low 档） */
  promptHint?: string
  /** 是否需要抬高输出上限 */
  boostMaxTokens?: boolean
}

/** 思考强度三档映射 */
export interface ThinkingMapping {
  low: ThinkingLevelConfig
  high: ThinkingLevelConfig
  max: ThinkingLevelConfig
}

/** API 形态 */
export type ApiShape = 'chat-completions' | 'responses'

export interface ModelConfig {
  id: string
  name: string
  vendor: string
  /** 厂商/端点 baseURL（OpenAI 协议） */
  baseURL: string
  /** 是否用户自定义 */
  custom: boolean
  /** API 形态 */
  apiShape: ApiShape
  /** 本地兼容端点可关闭鉴权；内置模型默认要求密钥。 */
  apiKeyRequired?: boolean
  /** 模态能力 */
  modalities: Modality[]
  /** 上下文窗口大小（tokens） */
  contextWindow: number
  /** 最大输出 tokens */
  maxOutputTokens: number
  /** 思考强度三档映射（§3.5 表） */
  thinking: ThinkingMapping
  /** 是否强制思考 */
  forcedThinking: boolean
  /** 多模态+思考组合是否已验证 */
  multimodalThinkingVerified: boolean
  /** 采样参数白名单（避免静默失效，§3.5 规则 4） */
  samplingWhitelist?: string[]
  /** usage 缓存字段路径（§3.6 表） */
  usageCachedTokensPath?: string
  /** 缓存字段维度 */
  usageCacheScope?: 'top' | 'nested'
  /** reasoning_content / 思维链透传配置（§3.5 规则 2） */
  reasoning?: {
    clearThinking?: boolean
    keep?: boolean
    preserveThinking?: boolean
  }
}

/**
 * 内置模型清单（§2.1）—— 思考强度三档映射依据 §3.5 表
 */
const qwenThinking: ThinkingMapping = {
  low: { params: { enable_thinking: true, thinking_budget: 4096 }, boostMaxTokens: false },
  high: { params: { thinking_budget: 16384 }, boostMaxTokens: false },
  max: { params: { thinking_budget: 32768 }, boostMaxTokens: true }
}

const glmThinking: ThinkingMapping = {
  low: { params: { thinking: { type: 'disabled' } }, boostMaxTokens: false },
  high: { params: { thinking: { type: 'enabled' } }, boostMaxTokens: false },
  max: { params: { thinking: { type: 'enabled' } }, boostMaxTokens: false }
}

const glmForcedThinking: ThinkingMapping = {
  low: { params: { thinking: { type: 'enabled' } }, promptHint: '此任务请简洁思考，直接输出。', boostMaxTokens: false },
  high: { params: { thinking: { type: 'enabled' } }, boostMaxTokens: false },
  max: { params: { thinking: { type: 'enabled' } }, boostMaxTokens: false }
}

const deepseekThinking: ThinkingMapping = {
  low: { params: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, boostMaxTokens: false },
  high: { params: { reasoning_effort: 'high' }, boostMaxTokens: false },
  max: { params: { reasoning_effort: 'max' }, boostMaxTokens: true }
}

const kimiK3Thinking: ThinkingMapping = {
  low: { params: { reasoning_effort: 'low' }, boostMaxTokens: false },
  high: { params: { reasoning_effort: 'high' }, boostMaxTokens: false },
  max: { params: { reasoning_effort: 'max' }, boostMaxTokens: true }
}

const kimiForcedThinking: ThinkingMapping = {
  low: { params: {}, promptHint: '此任务请简洁思考，直接输出。', boostMaxTokens: false },
  high: { params: {}, boostMaxTokens: false },
  max: { params: {}, boostMaxTokens: false }
}

const minimaxThinking: ThinkingMapping = {
  low: { params: { thinking: { type: 'disabled' } }, boostMaxTokens: false },
  high: { params: { thinking: { type: 'adaptive' } }, boostMaxTokens: false },
  max: { params: { thinking: { type: 'adaptive' } }, boostMaxTokens: true }
}

export const BUILTIN_MODELS: ModelConfig[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    vendor: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: deepseekThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: ['temperature', 'top_p', 'max_tokens', 'stream'],
    usageCachedTokensPath: 'prompt_cache_hit_tokens',
    usageCacheScope: 'top',
    reasoning: { clearThinking: false }
  },
  {
    id: 'deepseek-v4-flash',
    name: 'deepseek-v4-flash',
    vendor: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: deepseekThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: ['temperature', 'top_p', 'max_tokens', 'stream'],
    usageCachedTokensPath: 'prompt_cache_hit_tokens',
    usageCacheScope: 'top',
    reasoning: { clearThinking: false }
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'deepseek-v4-flash-vision-exp',
    vendor: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: deepseekThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: ['temperature', 'top_p', 'max_tokens', 'stream'],
    usageCachedTokensPath: 'prompt_cache_hit_tokens',
    usageCacheScope: 'top',
    reasoning: { clearThinking: false }
  },
  {
    id: 'glm-5.2',
    name: 'glm-5.2',
    vendor: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: glmThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: { clearThinking: false }
  },
  {
    id: 'glm-5.3',
    name: 'glm-5.3',
    vendor: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: glmForcedThinking,
    forcedThinking: true,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: { clearThinking: false }
  },
  {
    id: 'glm-5.3-flash',
    name: 'glm-5.3-flash',
    vendor: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: glmForcedThinking,
    forcedThinking: true,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: { clearThinking: false }
  },
  {
    id: 'qwen3.7-plus',
    name: 'qwen3.7-plus',
    vendor: '阿里云',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 131072,
    maxOutputTokens: 8192,
    thinking: qwenThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: { preserveThinking: true }
  },
  {
    id: 'qwen3.8-max',
    name: 'qwen3.8-max',
    vendor: '阿里云',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 262144,
    maxOutputTokens: 131072,
    thinking: qwenThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: { preserveThinking: true }
  },
  {
    id: 'kimi-k3',
    name: 'kimi-k3',
    vendor: '月之暗面',
    baseURL: 'https://api.moonshot.cn/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 262144,
    maxOutputTokens: 16384,
    thinking: kimiK3Thinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: ['max_tokens'],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'top',
    reasoning: { keep: true }
  },
  {
    id: 'kimi-k2.7-code',
    name: 'kimi-k2.7-code',
    vendor: '月之暗面',
    baseURL: 'https://api.moonshot.cn/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 262144,
    maxOutputTokens: 16384,
    thinking: kimiForcedThinking,
    forcedThinking: true,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'top',
    reasoning: { keep: true }
  },
  {
    id: 'MiniMax-M3',
    name: 'MiniMax-M3',
    vendor: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/v1',
    custom: false,
    apiShape: 'chat-completions',
    modalities: ['text', 'image', 'video'],
    contextWindow: 262144,
    maxOutputTokens: 16384,
    thinking: minimaxThinking,
    forcedThinking: false,
    multimodalThinkingVerified: false,
    samplingWhitelist: [],
    usageCachedTokensPath: 'cached_tokens',
    usageCacheScope: 'nested',
    reasoning: {}
  }
]

/** 按 id 查询模型 */
export function getModel(id: string): ModelConfig | undefined {
  return BUILTIN_MODELS.find((m) => m.id === id)
}

/** 厂商列表 */
export const VENDORS = Array.from(new Set(BUILTIN_MODELS.map((m) => m.vendor)))
