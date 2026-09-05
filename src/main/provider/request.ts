import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import type { ContentPart } from '@core/events'
import type { ModelConfig } from '@core/models'
import type { JsonValue } from '@core/types'
import type { MediaResolver, PreparedProviderRequest, ProviderMessage, ProviderRequest, ProviderTool } from './types'
import { canonicalJson } from './canonical'
import type { VideoFrameExtractor } from '../media/frames'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

export async function prepareProviderRequest(
  request: ProviderRequest,
  resolveMedia: MediaResolver = resolveMediaSource,
  extractVideoFrames?: VideoFrameExtractor
): Promise<PreparedProviderRequest> {
  if (request.model.apiKeyRequired !== false && !request.apiKey.trim()) throw new Error('模型 API Key 不能为空')

  const apiShape = request.model.apiShape
  const body = await buildBody(request, resolveMedia, extractVideoFrames)
  return {
    url: resolveEndpoint(request.model.baseURL, apiShape),
    apiShape,
    init: {
      method: 'POST',
      headers: {
        ...(request.apiKey.trim() ? { authorization: `Bearer ${request.apiKey}` } : {}),
        'content-type': 'application/json'
      },
      body: canonicalJson(body),
      signal: request.signal
    }
  }
}

export function resolveEndpoint(baseURL: string, shape: ProviderRequest['model']['apiShape']): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`无效的模型 baseURL: ${baseURL}`)
  const suffix = shape === 'responses' ? '/responses' : '/chat/completions'
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`
}

async function buildBody(request: ProviderRequest, resolveMedia: MediaResolver, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue> {
  const thinking = request.model.thinking[request.thinkingLevel]
  const maxTokens = Math.min(
    request.model.contextWindow,
    request.maxOutputTokens ?? (thinking.boostMaxTokens
      ? request.model.maxOutputTokens
      : request.model.maxOutputTokens)
  )
  const sampling = filterSampling(request.sampling ?? {}, request.model.samplingWhitelist)
  const messages = appendPromptHint(request.messages, thinking.promptHint)

  const body: Record<string, JsonValue> = {
    model: request.model.id,
    stream: true,
    ...sampling,
    ...thinking.params
  }
  if (request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey

  if (request.model.apiShape === 'responses') {
    body.input = (await Promise.all(messages.map((message) => toResponsesItems(message, resolveMedia, request.model, extractVideoFrames)))).flat()
    body.max_output_tokens = maxTokens
    if (request.tools?.length) body.tools = request.tools.map(toResponsesTool)
  } else {
    body.messages = await Promise.all(messages.map((message) => toChatMessage(message, resolveMedia, request.model, extractVideoFrames)))
    body.max_tokens = maxTokens
    body.stream_options = { include_usage: true }
    if (request.tools?.length) body.tools = request.tools.map(toChatTool)
  }
  return body
}

function filterSampling(values: Record<string, JsonValue>, whitelist?: string[]): Record<string, JsonValue> {
  if (!whitelist) return values
  const allowed = new Set(whitelist)
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)))
}

function appendPromptHint(messages: ProviderMessage[], hint?: string): ProviderMessage[] {
  if (!hint) return messages
  const copy = messages.map((message) => ({ ...message }))
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    const message = copy[index]
    if (message.role !== 'user') continue
    message.content =
      typeof message.content === 'string'
        ? `${message.content}\n\n${hint}`
        : [...message.content, { kind: 'text', text: hint }]
    return copy
  }
  return [...copy, { role: 'user', content: hint }]
}

async function toChatMessage(message: ProviderMessage, resolveMedia: MediaResolver, model: ModelConfig, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue> {
  const value: Record<string, JsonValue> = {
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : (await Promise.all(message.content.map((part) => toChatContentParts(part, resolveMedia, model, extractVideoFrames)))).flat()
  }
  if (message.name) value.name = message.name
  if (message.reasoningContent) value.reasoning_content = message.reasoningContent
  if (message.toolCallId) value.tool_call_id = message.toolCallId
  if (message.toolCalls?.length) {
    value.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments }
    }))
  }
  return value
}

async function toResponsesMessage(message: ProviderMessage, resolveMedia: MediaResolver, model: ModelConfig, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue> {
  if (message.role === 'tool' && message.toolCallId) {
    return {
      type: 'function_call_output',
      call_id: message.toolCallId,
      output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    }
  }
  return {
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : (await Promise.all(message.content.map((part) => toResponsesContentParts(part, resolveMedia, model, extractVideoFrames)))).flat()
  }
}

async function toResponsesItems(message: ProviderMessage, resolveMedia: MediaResolver, model: ModelConfig, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue[]> {
  const items: JsonValue[] = []
  if (message.content || !message.toolCalls?.length) items.push(await toResponsesMessage(message, resolveMedia, model, extractVideoFrames))
  for (const call of message.toolCalls ?? []) {
    items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments })
  }
  return items
}

/** 视频内容按模型能力转换：原生 video_url、抽帧图片序列；不支持视频的模型直接报错。 */
async function toChatContentParts(part: ContentPart, resolveMedia: MediaResolver, model: ModelConfig, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue[]> {
  if (part.kind === 'text') return [{ type: 'text', text: part.text ?? '' }]
  if (part.kind === 'image') return [{ type: 'image_url', image_url: { url: await requireMediaSource(part, resolveMedia) } }]
  if (!model.modalities.includes('video')) throw new Error(`模型 ${model.id} 不支持视频输入，请改用支持视频的模型`)
  if (model.videoStrategy === 'image-frames') {
    const frames = await requireVideoFrames(part, resolveMedia, extractVideoFrames)
    return [
      { type: 'text', text: `[视频已按帧采样为 ${frames.length} 张图片]` },
      ...frames.map((url) => ({ type: 'image_url', image_url: { url } }))
    ]
  }
  return [{ type: 'video_url', video_url: { url: await requireMediaSource(part, resolveMedia) } }]
}

async function toResponsesContentParts(part: ContentPart, resolveMedia: MediaResolver, model: ModelConfig, extractVideoFrames?: VideoFrameExtractor): Promise<JsonValue[]> {
  if (part.kind === 'text') return [{ type: 'input_text', text: part.text ?? '' }]
  if (part.kind === 'image') return [{ type: 'input_image', image_url: await requireMediaSource(part, resolveMedia) }]
  if (!model.modalities.includes('video')) throw new Error(`模型 ${model.id} 不支持视频输入，请改用支持视频的模型`)
  if (model.videoStrategy === 'image-frames') {
    const frames = await requireVideoFrames(part, resolveMedia, extractVideoFrames)
    return [
      { type: 'input_text', text: `[视频已按帧采样为 ${frames.length} 张图片]` },
      ...frames.map((url) => ({ type: 'input_image', image_url: url }))
    ]
  }
  return [{ type: 'input_video', video_url: await requireMediaSource(part, resolveMedia) }]
}

async function requireVideoFrames(part: ContentPart, resolveMedia: MediaResolver, extractVideoFrames?: VideoFrameExtractor): Promise<string[]> {
  if (!extractVideoFrames) throw new Error('当前模型要求抽帧输入视频，但未配置视频抽帧（ffmpeg）；请在设置中启用或改用支持 video_url 的模型')
  if (!part.source) throw new Error('视频内容缺少 source')
  return extractVideoFrames(part.source, part.mimeType)
}

async function requireMediaSource(part: ContentPart, resolveMedia: MediaResolver): Promise<string> {
  if (!part.source) throw new Error(`${part.kind} 内容缺少 source`)
  return resolveMedia(part.source, part.mimeType)
}

function toChatTool(tool: ProviderTool): JsonValue {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.strict === undefined ? {} : { strict: tool.strict })
    }
  }
}

function toResponsesTool(tool: ProviderTool): JsonValue {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.strict === undefined ? {} : { strict: tool.strict })
  }
}

export async function resolveMediaSource(source: string, mimeType?: string): Promise<string> {
  if (/^(data:|https?:\/\/)/i.test(source)) return source
  if (!isAbsolute(source)) throw new Error(`媒体文件必须使用绝对路径: ${source}`)
  const bytes = await readFile(source)
  const resolvedMime = mimeType ?? MIME_BY_EXTENSION[extname(source).toLowerCase()] ?? 'application/octet-stream'
  return `data:${resolvedMime};base64,${bytes.toString('base64')}`
}
