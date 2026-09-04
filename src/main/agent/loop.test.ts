import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getModel } from '@core/models'
import { PermissionService } from '@core/permission'
import type { SessionEvent } from '@core/events'
import type { ProviderRequest, ProviderStreamEvent } from '../provider/types'
import { createBuiltinToolRegistry } from '../tools/builtin'
import { AgentLoop, type ProviderClient } from './loop'

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
