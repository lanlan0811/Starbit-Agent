import { describe, expect, it } from 'vitest'
import { getModel } from '@core/models'
import type { ProviderMessage } from '../provider/types'
import { ContextManager, estimateTextTokens } from './context'

describe('ContextManager', () => {
  it('按中英文内容估算 token 并报告 90%/97% 阈值', () => {
    const model = { ...getModel('deepseek-v4-pro')!, contextWindow: 100, maxOutputTokens: 10 }
    const manager = new ContextManager(model)
    expect(estimateTextTokens('abcd中文')).toBe(3)
    expect(manager.inspect([{ role: 'system', content: 'a'.repeat(328) }]).level).toBe('warning')
    expect(manager.inspect([{ role: 'system', content: 'a'.repeat(360) }]).level).toBe('critical')
  })

  it('microcompaction 只清理早期工具结果且保持确定性', () => {
    const model = getModel('qwen3.8-max')!
    const manager = new ContextManager(model, { preservedRecentMessages: 2, toolPreviewCharacters: 64 })
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'stable' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'Read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', name: 'Read', content: 'x'.repeat(2_000) },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '完成' }
    ]
    const first = manager.microcompact(messages)
    const second = manager.microcompact(messages)
    expect(first.changed).toBe(1)
    expect(first.messages).toEqual(second.messages)
    expect(String(first.messages[2].content)).toContain('microcompacted tool result')
    expect(messages[2].content).toHaveLength(2_000)
  })

  it('结构化摘要保留 system 前缀和近期完整工具调用组', () => {
    const manager = new ContextManager(getModel('qwen3.8-max')!, { preservedRecentMessages: 2 })
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'stable' },
      { role: 'user', content: '旧消息' },
      { role: 'assistant', content: '调用', toolCalls: [{ id: '1', name: 'Read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', name: 'Read', content: '结果' },
      { role: 'assistant', content: '近期回复' }
    ]
    const compacted = manager.compactWithSummary(messages, '- 已读取文件')
    expect(compacted.messages[0]).toEqual(messages[0])
    expect(compacted.messages[1].content).toContain('已读取文件')
    expect(compacted.messages.some((message) => message.role === 'tool')).toBe(true)
  })
})
