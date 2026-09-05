import { describe, expect, it } from 'vitest'
import { getModel, type ModelConfig } from '@core/models'
import { PrefixFingerprintTracker, canonicalJson } from './canonical'
import { parseProviderEvent } from './openai-provider'
import { prepareProviderRequest, resolveEndpoint } from './request'
import { decodeSse } from './sse'
import { normalizeUsage } from './usage'

function model(id: string): ModelConfig {
  const value = getModel(id)
  if (!value) throw new Error(`测试模型不存在: ${id}`)
  return value
}

describe('Provider 请求组装', () => {
  it('Responses 工具调用与结果成对回传，Chat 保留推理内容', async () => {
    const messages = [
      { role: 'assistant' as const, content: '', reasoningContent: '分析', toolCalls: [{ id: 'call-1', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, toolCallId: 'call-1', content: '内容' }
    ]
    const base = { model: model('deepseek-v4-pro'), apiKey: 'key', thinkingLevel: 'max' as const, maxOutputTokens: 100, messages }
    const chat = JSON.parse(String((await prepareProviderRequest(base)).init.body))
    expect(chat.messages[0].reasoning_content).toBe('分析')
    expect(chat.max_tokens).toBe(100)
    const responses = JSON.parse(String((await prepareProviderRequest({ ...base, model: { ...base.model, apiShape: 'responses' } })).init.body))
    expect(responses.input).toEqual([
      { type: 'function_call', call_id: 'call-1', name: 'Read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-1', output: '内容' }
    ])
  })
  it('生成稳定的 Chat Completions 请求并过滤采样参数', async () => {
    const prepared = await prepareProviderRequest({
      model: model('deepseek-v4-pro'),
      apiKey: 'test-key',
      thinkingLevel: 'high',
      messages: [{ role: 'user', content: '你好' }],
      sampling: { temperature: 0.2, presence_penalty: 0.5 },
      promptCacheKey: 'session-1'
    })

    expect(prepared.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(prepared.init.headers).toEqual({ authorization: 'Bearer test-key', 'content-type': 'application/json' })
    const body = JSON.parse(String(prepared.init.body))
    expect(body.temperature).toBe(0.2)
    expect(body.presence_penalty).toBeUndefined()
    expect(body.reasoning_effort).toBe('high')
    expect(body.prompt_cache_key).toBe('session-1')
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('转换 Responses 多模态内容与工具定义', async () => {
    const responsesModel = { ...model('qwen3.8-max'), apiShape: 'responses' as const }
    const prepared = await prepareProviderRequest({
      model: responsesModel,
      apiKey: 'test-key',
      thinkingLevel: 'low',
      messages: [
        {
          role: 'user',
          content: [
            { kind: 'text', text: '描述图片' },
            { kind: 'image', source: 'https://example.com/a.png' }
          ]
        }
      ],
      tools: [{ name: 'read_file', description: '读取文件', parameters: { type: 'object' } }]
    })
    const body = JSON.parse(String(prepared.init.body))

    expect(body.input[0].content).toEqual([
      { text: '描述图片', type: 'input_text' },
      { image_url: 'https://example.com/a.png', type: 'input_image' }
    ])
    expect(body.tools[0]).toEqual({
      description: '读取文件',
      name: 'read_file',
      parameters: { type: 'object' },
      type: 'function'
    })
    expect(body.max_output_tokens).toBe(responsesModel.maxOutputTokens)
  })

  it('拒绝空密钥与非法端点', async () => {
    await expect(
      prepareProviderRequest({ model: model('glm-5.2'), apiKey: ' ', thinkingLevel: 'low', messages: [] })
    ).rejects.toThrow('API Key')
    expect(() => resolveEndpoint('localhost:11434/v1', 'chat-completions')).toThrow('baseURL')
  })

  it('视频按模型策略转换为 video_url 或抽帧图片序列', async () => {
    const echoSource = async (source: string): Promise<string> => source
    const media = [{ kind: 'video' as const, source: 'D:/media/clip.mp4', mimeType: 'video/mp4' }]
    const native = JSON.parse(String((await prepareProviderRequest({
      model: model('qwen3.8-max'),
      apiKey: 'k',
      thinkingLevel: 'low',
      messages: [{ role: 'user', content: media }]
    }, echoSource)).init.body))
    expect(native.messages[0].content).toEqual([{ type: 'video_url', video_url: { url: 'D:/media/clip.mp4' } }])

    const frames = ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB']
    const degraded = JSON.parse(String((await prepareProviderRequest({
      model: model('deepseek-v4-flash-vision-exp'),
      apiKey: 'k',
      thinkingLevel: 'low',
      messages: [{ role: 'user', content: media }]
    }, echoSource, async () => frames)).init.body))
    expect(degraded.messages[0].content).toEqual([
      { type: 'text', text: '[视频已按帧采样为 2 张图片]' },
      { type: 'image_url', image_url: { url: frames[0] } },
      { type: 'image_url', image_url: { url: frames[1] } }
    ])
  })

  it('不支持视频的模型直接报错且不抽帧', async () => {
    await expect(
      prepareProviderRequest({
        model: model('glm-5.2'),
        apiKey: 'k',
        thinkingLevel: 'low',
        messages: [{ role: 'user', content: [{ kind: 'video', source: 'D:/media/clip.mp4' }] }]
      }, async (source) => source, async () => { throw new Error('不应调用抽帧') })
    ).rejects.toThrow('不支持视频输入')
  })
})

describe('usage 归一化', () => {
  it('读取 DeepSeek 顶层缓存字段', () => {
    expect(
      normalizeUsage(
        { prompt_tokens: 100, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, completion_tokens: 25 },
        model('deepseek-v4-pro')
      )
    ).toEqual({ promptTokens: 100, cachedTokens: 80, cacheWriteTokens: 0, outputTokens: 25, hitRate: 0.8 })
  })

  it('读取 Responses 嵌套字段', () => {
    expect(
      normalizeUsage(
        { input_tokens: 200, input_tokens_details: { cached_tokens: 190, cache_write_tokens: 5 }, output_tokens: 30 },
        { ...model('qwen3.8-max'), apiShape: 'responses' },
        'responses'
      )
    ).toEqual({ promptTokens: 200, cachedTokens: 190, cacheWriteTokens: 5, outputTokens: 30, hitRate: 0.95 })
  })
})

describe('稳定前缀', () => {
  it('规范化对象键并定位变化分段', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    const tracker = new PrefixFingerprintTracker()
    const initial = tracker.compare({ system: '固定', tools: [{ name: 'Read' }], skills: [] })
    const stable = tracker.compare({ tools: [{ name: 'Read' }], skills: [], system: '固定' })
    const changed = tracker.compare({ system: '变化', tools: [{ name: 'Read' }], skills: [] })
    expect(initial.changed).toBe(false)
    expect(stable).toEqual(initial)
    expect(changed.changedSections).toEqual(['system'])
  })
})

describe('SSE 与流事件解析', () => {
  it('处理跨网络分块与多行 data', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message\r\ndata: {"a":'))
        controller.enqueue(encoder.encode('1}\r\n\r\ndata: [DONE]\n\n'))
        controller.close()
      }
    })
    const messages = []
    for await (const message of decodeSse(stream)) messages.push(message)
    expect(messages).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: undefined, data: '[DONE]' }
    ])
  })

  it('解析 Chat 文本、思考、工具与 usage 增量', () => {
    const events = parseProviderEvent(
      {
        choices: [
          {
            delta: {
              content: '完成',
              reasoning_content: '分析',
              tool_calls: [{ index: 0, id: 'call-1', function: { name: 'Read', arguments: '{"path":' } }]
            }
          }
        ],
        usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 9, completion_tokens: 2 }
      },
      undefined,
      model('deepseek-v4-pro')
    )
    expect(events.map((event) => event.type)).toEqual(['text-delta', 'reasoning-delta', 'tool-call-delta', 'usage'])
  })

  it('解析 Responses 完成事件', () => {
    const responseModel = { ...model('qwen3.8-max'), apiShape: 'responses' as const }
    const events = parseProviderEvent(
      {
        type: 'response.completed',
        response: {
          id: 'resp-1',
          usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 18 }, output_tokens: 4 }
        }
      },
      'response.completed',
      responseModel
    )
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { promptTokens: 20, cachedTokens: 18, cacheWriteTokens: 0, outputTokens: 4, hitRate: 0.9 }
      },
      { type: 'done', responseId: 'resp-1' }
    ])
  })
})
