import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getModel } from '@core/models'
import { PermissionService } from '@core/permission'
import type { SessionEvent } from '@core/events'
import type { ProviderRequest, ProviderStreamEvent } from '../provider/types'
import { createBuiltinToolRegistry } from '../tools/builtin'
import { AgentLoop, rebuildMessages, type ProviderClient } from './loop'
import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'

class FakeProvider implements ProviderClient {
  calls = 0
  async *stream(_request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
    this.calls += 1
    if (this.calls === 1) {
      yield { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'Write', argumentsDelta: '{"path":"result.txt","content":"done"}' }
      yield { type: 'usage', usage: { promptTokens: 100, cachedTokens: 98, cacheWriteTokens: 0, outputTokens: 10, hitRate: 0.98 } }
    } else yield { type: 'text-delta', delta: '任务完成' }
    yield { type: 'done' }
  }
}

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('AgentLoop', () => {
  it('并行读取完成顺序不同仍按模型调用顺序写入历史', async () => {
    const events: SessionEvent[] = []
    const registry = new ToolRegistry()
    let finishSlow: () => void = () => undefined
    const slow = new Promise<void>((resolve) => { finishSlow = resolve })
    for (const name of ['Slow', 'Fast']) registry.register({
      name, fullName: name, kind: 'read', readOnly: true, semanticLabel: name, source: 'builtin', description: name,
      inputSchema: z.object({}), inputJsonSchema: { type: 'object', properties: {} }
    }, async () => {
      if (name === 'Slow') await slow
      else finishSlow()
      return { content: name }
    })
    let round = 0
    const provider: ProviderClient = { async *stream(request) {
      if (round++ === 0) {
        yield { type: 'tool-call-delta', index: 0, id: 'slow', name: 'Slow', argumentsDelta: '{}' }
        yield { type: 'tool-call-delta', index: 1, id: 'fast', name: 'Fast', argumentsDelta: '{}' }
      } else {
        expect(request.messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId)).toEqual(['slow', 'fast'])
        yield { type: 'text-delta', delta: '完成' }
      }
      yield { type: 'done' }
    } }
    await new AgentLoop({
      sessionId: 'parallel', workspacePath: process.cwd(), model: getModel('qwen3.8-max')!, apiKey: 'test',
      thinkingLevel: 'high', systemPrompt: 'stable', skillsIndex: '', registry, permissions: new PermissionService(), provider,
      onEvent: (event) => events.push(event), confirm: async () => ({ outcome: 'deny', scope: 'once' })
    }).run('读取')
    expect(events.filter((event) => event.type === 'toolResult' && event.result.status === 'success').map((event) => event.type === 'toolResult' && event.result.toolCallId)).toEqual(['slow', 'fast'])
  })
  it('完整与微压缩快照重放后准确保留调用组和近期消息', () => {
    const snapshot = [
      { role: 'system' as const, content: '先前摘要' },
      { role: 'user' as const, content: '读取文件' },
      { role: 'assistant' as const, content: '', reasoningContent: '选择文件', toolCalls: [{ id: 'call', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, toolCallId: 'call', name: 'Read', content: '结果' }
    ]
    for (const level of ['micro', 'full'] as const) {
      const events: SessionEvent[] = [
        { id: 'old', sessionId: 's', createdAt: 0, type: 'userMessage', content: '已压缩的旧消息' },
        { id: 'compact', sessionId: 's', createdAt: 1, type: 'compaction', level, summary: '摘要', preservedRange: [0, 1], contextSnapshot: snapshot },
        { id: 'new', sessionId: 's', createdAt: 2, type: 'userMessage', content: '继续' }
      ]
      expect(rebuildMessages(events, 'stable')).toEqual([{ role: 'system', content: 'stable' }, ...snapshot, { role: 'user', content: '继续' }])
    }
  })

  it('手动压缩可取消，取消时不调用模型、不产生压缩事件', async () => {
    const events: SessionEvent[] = []
    const provider = new FakeProvider()
    const loop = new AgentLoop({
      sessionId: 'cancel-compact', workspacePath: process.cwd(), model: getModel('qwen3.8-max')!,
      apiKey: 'test', thinkingLevel: 'high', systemPrompt: 'stable', skillsIndex: '',
      registry: createBuiltinToolRegistry({ shell: { executable: process.execPath, args: ['-e'] } }),
      permissions: new PermissionService(), provider, onEvent: (event) => events.push(event),
      confirm: async () => ({ outcome: 'deny', scope: 'once' }), confirmCompaction: async () => false
    })
    await loop.run('/compact')
    expect(provider.calls).toBe(0)
    expect(events.some((event) => event.type === 'compaction')).toBe(false)
  })
  it('执行模型工具调用并把结果回填后继续对话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-loop-'))
    roots.push(root)
    const events: SessionEvent[] = []
    const permissions = new PermissionService()
    permissions.setMode('fullAccess')
    const loop = new AgentLoop({
      sessionId: 'session-test',
      workspacePath: root,
      model: getModel('qwen3.8-max')!,
      apiKey: 'test',
      thinkingLevel: 'max',
      systemPrompt: 'stable system',
      skillsIndex: 'none',
      registry: createBuiltinToolRegistry({ shell: { executable: process.execPath, args: ['-e'] } }),
      permissions,
      provider: new FakeProvider(),
      onEvent: (event) => events.push(event),
      confirm: async () => ({ outcome: 'allow', scope: 'once' })
    })
    await loop.run('创建结果文件')
    expect(await readFile(join(root, 'result.txt'), 'utf8')).toBe('done')
    expect(events.some((event) => event.type === 'usage' && event.hitRate === 0.98)).toBe(true)
    expect(events.some((event) => event.type === 'assistantMessage' && event.text === '任务完成')).toBe(true)
  })
})
