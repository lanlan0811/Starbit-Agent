import { describe, expect, it } from 'vitest'
import { getModel } from '@core/models'
import { PermissionService } from '@core/permission'
import type { SessionEvent } from '@core/events'
import type { ProviderRequest, ProviderStreamEvent } from '../provider/types'
import { AgentLoop, type ProviderClient } from './loop'
import { estimateMessageTokens } from './context'
import { ToolRegistry } from '@core/tools/registry'
import { z } from 'zod'

/**
 * 缓存回归门禁（§3.6）：以"前缀字节级一致 ⇒ 命中"为缓存语义，驱动长前缀
 * 多轮会话。系统提示冻结、工具列表冻结、消息 append-only 三条硬规则任何一条
 * 被破坏（如 system 混入时间戳、工具列表抖动、历史回插），公共前缀即坍塌，
 * 累计命中率跌破 95% 门禁。
 */

const PREFIX_TOKENS = 120_000
const TOTAL_REQUESTS = 24
const ROUND_REQUESTS = 12
const HIT_RATE_GATE = 0.95

/** 前缀缓存语义的 stub provider：与历史任一请求的最长公共前缀记为命中。 */
class PrefixCacheProvider implements ProviderClient {
  readonly requests: string[][] = []
  readonly usageSamples: Array<{ promptTokens: number; cachedTokens: number }> = []
  private round = 0

  constructor(private readonly echoToolName: string) {}

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
    const serialized = [
      // tools 定义属于稳定前缀的一部分（会话期冻结）
      JSON.stringify(request.tools ?? []),
      ...request.messages.map((message) => JSON.stringify(message))
    ]
    let commonPrefix = 0
    for (const previous of this.requests) {
      let index = 0
      while (index < previous.length && index < serialized.length && previous[index] === serialized[index]) index += 1
      commonPrefix = Math.max(commonPrefix, index)
    }
    const weights = serialized.map((line, position) => (position === 0 ? 0 : estimateMessageTokens(request.messages[position - 1])))
    const promptTokens = weights.reduce((total, value) => total + value, 0)
    const cachedTokens = weights.slice(0, commonPrefix).reduce((total, value) => total + value, 0)
    this.requests.push(serialized)
    this.usageSamples.push({ promptTokens, cachedTokens })
    yield {
      type: 'usage',
      usage: { promptTokens, cachedTokens, cacheWriteTokens: 0, outputTokens: 8, hitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0 }
    }
    this.round += 1
    if (this.round % ROUND_REQUESTS !== 0) {
      yield { type: 'tool-call-delta', index: 0, id: `call-${this.round}`, name: this.echoToolName, argumentsDelta: JSON.stringify({ text: 'step' }) }
    } else {
      yield { type: 'text-delta', delta: '任务完成' }
    }
    yield { type: 'done' }
  }
}

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'Echo',
    fullName: 'Echo',
    description: '回声工具',
    kind: 'read',
    readOnly: true,
    semanticLabel: 'Echo',
    source: 'builtin',
    inputSchema: z.object({ text: z.string().optional() }),
    inputJsonSchema: { type: 'object', properties: { text: { type: 'string' } } }
  }, async () => ({ content: 'ok' }))
  return registry
}

/** 生成约 PREFIX_TOKENS 的既有历史（等价于长会话中段重放的稳定前缀）。 */
function seedEvents(sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = []
  const filler = 'x'.repeat(PREFIX_TOKENS * 4)
  events.push({ id: 'seed-1', sessionId, createdAt: 1, type: 'userMessage', content: filler })
  events.push({ id: 'seed-2', sessionId, createdAt: 2, type: 'assistantMessage', text: '历史已就绪', toolCalls: [] })
  return events
}

describe('缓存回归门禁', () => {
  it(`长前缀多轮会话累计命中率 ≥ ${(HIT_RATE_GATE * 100).toFixed(0)}%`, { timeout: 60_000 }, async () => {
    const provider = new PrefixCacheProvider('Echo')
    const events: SessionEvent[] = []
    const loop = new AgentLoop({
      sessionId: 'cache-gate',
      workspacePath: process.cwd(),
      model: getModel('qwen3.8-max')!,
      apiKey: 'test',
      thinkingLevel: 'low',
      systemPrompt: '你是衔星助手。环境信息已冻结。',
      skillsIndex: '',
      registry: buildRegistry(),
      permissions: new PermissionService(),
      provider,
      initialEvents: seedEvents('cache-gate'),
      maxToolRounds: TOTAL_REQUESTS,
      onEvent: (event) => events.push(event),
      confirm: async () => ({ outcome: 'allow', scope: 'once' })
    })

    // 两个 run 段（各 12 轮请求），模拟同一会话内的连续任务
    await loop.run('开始执行')
    await loop.run('继续执行')

    const totalPrompt = provider.usageSamples.reduce((total, sample) => total + sample.promptTokens, 0)
    const totalCached = provider.usageSamples.reduce((total, sample) => total + sample.cachedTokens, 0)
    const hitRate = totalPrompt > 0 ? totalCached / totalPrompt : 0

    expect(provider.usageSamples).toHaveLength(TOTAL_REQUESTS)
    // 前缀体量必须真实生效（否则门禁形同虚设）
    expect(provider.usageSamples[0].promptTokens).toBeGreaterThan(PREFIX_TOKENS * 0.8)
    // 命中率门槛：系统提示/工具列表/历史任何非 append-only 变化都会击穿此断言
    expect(hitRate).toBeGreaterThanOrEqual(HIT_RATE_GATE)
    // 事件流中的 usage 事件与 provider 统计一致
    const usageEvents = events.filter((event) => event.type === 'usage')
    expect(usageEvents).toHaveLength(TOTAL_REQUESTS)
    const eventRate = usageEvents.reduce((total, event) => total + (event.type === 'usage' ? event.cachedTokens : 0), 0)
      / usageEvents.reduce((total, event) => total + (event.type === 'usage' ? event.promptTokens : 0), 0)
    expect(eventRate).toBeCloseTo(hitRate, 6)
  })

  it('系统提示漂移会被前缀对比捕获（反例验证门禁有效）', { timeout: 60_000 }, async () => {
    // 同样的会话，但每轮 system 前缀变化（模拟时间戳泄漏）→ 命中率应显著低于门禁
    class DriftingProvider extends PrefixCacheProvider {
      async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        const drifting = { ...request, messages: request.messages.map((message, index) => index === 0 ? { ...message, content: `${String(message.content)}#${Date.now()}` } : message) }
        yield* super.stream(drifting)
      }
    }
    const provider = new DriftingProvider('Echo')
    const loop = new AgentLoop({
      sessionId: 'cache-drift',
      workspacePath: process.cwd(),
      model: getModel('qwen3.8-max')!,
      apiKey: 'test',
      thinkingLevel: 'low',
      systemPrompt: '你是衔星助手。',
      skillsIndex: '',
      registry: buildRegistry(),
      permissions: new PermissionService(),
      provider,
      initialEvents: seedEvents('cache-drift'),
      maxToolRounds: TOTAL_REQUESTS,
      onEvent: () => undefined,
      confirm: async () => ({ outcome: 'allow', scope: 'once' })
    })
    await loop.run('开始执行')
    await loop.run('继续执行')
    const totalPrompt = provider.usageSamples.reduce((total, sample) => total + sample.promptTokens, 0)
    const totalCached = provider.usageSamples.reduce((total, sample) => total + sample.cachedTokens, 0)
    expect(totalCached / totalPrompt).toBeLessThan(HIT_RATE_GATE)
  })
})
