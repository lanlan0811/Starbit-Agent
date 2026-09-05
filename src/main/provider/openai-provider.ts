import type { ModelConfig } from '@core/models'
import { prepareProviderRequest, resolveMediaSource } from './request'
import { decodeSse, type SseMessage } from './sse'
import type { ProviderRequest, ProviderStreamEvent } from './types'
import { normalizeUsage } from './usage'

type UnknownRecord = Record<string, unknown>

export class OpenAiCompatibleProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
    const prepared = await prepareProviderRequest(request, resolveMediaSource, request.extractVideoFrames)
    const response = await this.fetcher(prepared.url, prepared.init)
    if (!response.ok) throw await createHttpError(response)
    if (!response.body) throw new Error('模型响应缺少可读取的流')

    let completed = false
    for await (const message of decodeSse(response.body)) {
      if (message.data === '[DONE]') {
        if (!completed) yield { type: 'done' }
        return
      }
      const payload = parsePayload(message)
      for (const event of parseProviderEvent(payload, message.event, request.model)) {
        if (event.type === 'done') completed = true
        yield event
      }
    }
    if (!completed) yield { type: 'done' }
  }
}

function parsePayload(message: SseMessage): UnknownRecord {
  try {
    return asRecord(JSON.parse(message.data))
  } catch {
    throw new Error(`无法解析模型 SSE 数据: ${message.data.slice(0, 200)}`)
  }
}

export function parseProviderEvent(payload: UnknownRecord, eventName: string | undefined, model: ModelConfig): ProviderStreamEvent[] {
  const type = String(payload.type ?? eventName ?? '')
  const events: ProviderStreamEvent[] = []

  if (type === 'error' || type === 'response.failed') {
    const error = asRecord(payload.error)
    throw new Error(String(error.message ?? payload.message ?? '模型流式响应失败'))
  }

  if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    events.push({ type: 'text-delta', delta: payload.delta })
  } else if (type.includes('reasoning') && type.endsWith('.delta') && typeof payload.delta === 'string') {
    events.push({ type: 'reasoning-delta', delta: payload.delta })
  } else if (type === 'response.function_call_arguments.delta') {
    events.push({
      type: 'tool-call-delta',
      index: numberOrZero(payload.output_index),
      id: stringOrUndefined(payload.call_id ?? payload.item_id),
      name: stringOrUndefined(payload.name),
      argumentsDelta: String(payload.delta ?? '')
    })
  } else if (type === 'response.output_item.added') {
    const item = asRecord(payload.item)
    if (item.type === 'function_call') {
      events.push({
        type: 'tool-call-delta',
        index: numberOrZero(payload.output_index),
        id: stringOrUndefined(item.call_id ?? item.id),
        name: stringOrUndefined(item.name),
        argumentsDelta: typeof item.arguments === 'string' ? item.arguments : ''
      })
    }
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  for (const choiceValue of choices) {
    const delta = asRecord(asRecord(choiceValue).delta)
    if (typeof delta.content === 'string') events.push({ type: 'text-delta', delta: delta.content })
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string') events.push({ type: 'reasoning-delta', delta: reasoning })
    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
    for (const callValue of toolCalls) {
      const call = asRecord(callValue)
      const fn = asRecord(call.function)
      events.push({
        type: 'tool-call-delta',
        index: numberOrZero(call.index),
        id: stringOrUndefined(call.id),
        name: stringOrUndefined(fn.name),
        argumentsDelta: typeof fn.arguments === 'string' ? fn.arguments : ''
      })
    }
  }

  const usage = extractUsage(payload)
  if (usage) events.push({ type: 'usage', usage: normalizeUsage(usage, model, model.apiShape) })
  if (type === 'response.completed') {
    const response = asRecord(payload.response)
    events.push({ type: 'done', responseId: stringOrUndefined(response.id) })
  }
  return events
}

function extractUsage(payload: UnknownRecord): unknown | null {
  if (payload.usage) return payload.usage
  const response = asRecord(payload.response)
  return response.usage ?? null
}

async function createHttpError(response: Response): Promise<Error> {
  const text = await response.text()
  let detail = text.slice(0, 500)
  try {
    const body = asRecord(JSON.parse(text))
    const error = asRecord(body.error)
    detail = String(error.message ?? body.message ?? detail)
  } catch {
    // 非 JSON 错误响应保留截断后的原文。
  }
  return new Error(`模型请求失败 (${response.status} ${response.statusText}): ${detail}`)
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
