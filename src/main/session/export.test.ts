import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '@core/session'
import type { SessionEvent } from '@core/events'
import { SESSION_ARCHIVE_VERSION, parseSessionArchive, sessionToMarkdown } from './export'

const meta: SessionMeta = {
  id: 'session-1',
  title: '测试会话',
  workspacePath: 'D:/workspace',
  mode: 'acceptEdits',
  model: 'qwen3.8-max',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000
}

function archiveOf(events: SessionEvent[]): string {
  return JSON.stringify({
    kind: 'starbit-session',
    version: SESSION_ARCHIVE_VERSION,
    exportedAt: Date.now(),
    session: { title: meta.title, workspacePath: meta.workspacePath, mode: meta.mode, model: meta.model, createdAt: meta.createdAt },
    events
  })
}

function userEvent(content: string): SessionEvent {
  return { id: 'e1', sessionId: meta.id, createdAt: Date.now(), type: 'userMessage', content }
}

describe('会话导出/导入', () => {
  it('Markdown 转写稿包含用户与助手内容', () => {
    const events: SessionEvent[] = [
      userEvent('帮我读文件'),
      { id: 'e2', sessionId: meta.id, createdAt: Date.now(), type: 'assistantMessage', text: '好的', toolCalls: [] }
    ]
    const markdown = sessionToMarkdown(meta, events)
    expect(markdown).toContain('# 测试会话')
    expect(markdown).toContain('帮我读文件')
    expect(markdown).toContain('好的')
    expect(markdown).toContain('自动编辑')
  })

  it('归档可解析且损坏文件给出明确错误', () => {
    const parsed = parseSessionArchive(archiveOf([userEvent('内容')]))
    expect(parsed.title).toContain('测试会话')
    expect(parsed.model).toBe('qwen3.8-max')
    expect(parsed.events).toHaveLength(1)
    expect(() => parseSessionArchive('not json')).toThrow('JSON')
    expect(() => parseSessionArchive('{"kind":"other"}')).toThrow('Starbit 会话归档')
    expect(() => parseSessionArchive(archiveOf([{ broken: true } as unknown as SessionEvent]))).toThrow('格式无效')
  })

  it('Markdown 捕获压缩与错误事件', () => {
    const events: SessionEvent[] = [
      { id: 'e1', sessionId: meta.id, createdAt: Date.now(), type: 'compaction', summary: 's', preservedRange: [0, 1] },
      { id: 'e2', sessionId: meta.id, createdAt: Date.now(), type: 'error', message: '模型超时' }
    ]
    const markdown = sessionToMarkdown(meta, events)
    expect(markdown).toContain('上下文压缩')
    expect(markdown).toContain('模型超时')
  })
})
