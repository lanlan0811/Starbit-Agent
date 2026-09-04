import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import type { ContentPart } from '@core/events'
import type { JsonValue } from '@core/types'
import type { MediaResolver, PreparedProviderRequest, ProviderMessage, ProviderRequest, ProviderTool } from './types'
import { canonicalJson } from './canonical'

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
  resolveMedia: MediaResolver = resolveMediaSource
): Promise<PreparedProviderRequest> {
  if (!request.apiKey.trim()) throw new Error('模型 API Key 不能为空')

  const apiShape = request.model.apiShape
  const body = await buildBody(request, resolveMedia)
  return {
    url: resolveEndpoint(request.model.baseURL, apiShape),
    apiShape,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.apiKey}`,
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

async function buildBody(request: ProviderRequest, resolveMedia: MediaResolver): Promise<JsonValue> {
  const thinking = request.model.thinking[request.thinkingLevel]
  const maxTokens = Math.min(
    request.model.contextWindow,
    thinking.boostMaxTokens
      ? request.model.maxOutputTokens
      : Math.min(request.maxOutputTokens ?? request.model.maxOutputTokens, request.model.maxOutputTokens)
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
    body.input = await Promise.all(messages.map((message) => toResponsesMessage(message, resolveMedia)))
    body.max_output_tokens = maxTokens
    if (request.tools?.length) body.tools = request.tools.map(toResponsesTool)
  } else {
    body.messages = await Promise.all(messages.map((message) => toChatMessage(message, resolveMedia)))
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

async function toChatMessage(message: ProviderMessage, resolveMedia: MediaResolver): Promise<JsonValue> {
  const value: Record<string, JsonValue> = {
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : await Promise.all(message.content.map((part) => toChatContentPart(part, resolveMedia)))
  }
  if (message.name) value.name = message.name
  if (message.toolCallId) value.tool_call_id = message.toolCallId
  return value
}

async function toResponsesMessage(message: ProviderMessage, resolveMedia: MediaResolver): Promise<JsonValue> {
  return {
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : await Promise.all(message.content.map((part) => toResponsesContentPart(part, resolveMedia)))
  }
}

async function toChatContentPart(part: ContentPart, resolveMedia: MediaResolver): Promise<JsonValue> {
  if (part.kind === 'text') return { type: 'text', text: part.text ?? '' }
  const source = await requireMediaSource(part, resolveMedia)
  if (part.kind === 'image') return { type: 'image_url', image_url: { url: source } }
  return { type: 'video_url', video_url: { url: source } }
}

async function toResponsesContentPart(part: ContentPart, resolveMedia: MediaResolver): Promise<JsonValue> {
  if (part.kind === 'text') return { type: 'input_text', text: part.text ?? '' }
  const source = await requireMediaSource(part, resolveMedia)
  if (part.kind === 'image') return { type: 'input_image', image_url: source }
  return { type: 'input_video', video_url: source }
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
