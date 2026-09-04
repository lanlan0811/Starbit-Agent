import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { JsonValue } from '@core/types'
import type { MemoryStore } from './store'
import type { MemoryScope } from './types'

export function registerMemoryTools(registry: ToolRegistry, store: MemoryStore): void {
  registry.register(
    {
      name: 'memory_search',
      fullName: 'memory_search',
      description: '检索用户级与当前工作区的长期记忆。不会修改 memory.md 或 AGENTS.md。',
      kind: 'memory',
      readOnly: true,
      dangerLevel: 0,
      semanticLabel: 'MemorySearch',
      source: 'builtin',
      timeoutMs: 10_000,
      inputSchema: z.object({
        query: z.string().min(1).max(20_000),
        scope: z.enum(['user', 'workspace']).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }),
      inputJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '需要查找的偏好、事实或上下文' },
          scope: { type: 'string', enum: ['user', 'workspace'], description: '可选记忆层级' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '最大返回条数，默认 10' }
        },
        required: ['query']
      }
    },
    async (input) => {
      const value = input as { query: string; scope?: MemoryScope; limit?: number }
      const hits = await store.search(value.query, { scope: value.scope, limit: value.limit })
      return {
        content: hits.length
          ? hits.map((hit, index) => `[${index + 1}] ${hit.scope}/${hit.source}\n${hit.content}`).join('\n\n')
          : '未找到相关长期记忆。',
        data: hits as unknown as JsonValue
      }
    }
  )

  registry.register(
    {
      name: 'memory',
      fullName: 'memory',
      description: '新增、更新或删除长期记忆，也可保存当前会话摘要。AGENTS.md 项目规则始终只读。',
      kind: 'memory',
      readOnly: false,
      dangerLevel: 1,
      semanticLabel: 'MemoryWrite',
      source: 'builtin',
      timeoutMs: 10_000,
      inputSchema: z.object({
        action: z.enum(['add', 'update', 'delete', 'save_session_summary']),
        scope: z.enum(['user', 'workspace']).optional(),
        id: z.string().min(1).max(128).optional(),
        content: z.string().min(1).max(4 * 1024 * 1024).optional()
      }),
      inputJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete', 'save_session_summary'] },
          scope: { type: 'string', enum: ['user', 'workspace'], description: '新增/摘要的目标层级，默认 workspace' },
          id: { type: 'string', description: '更新或删除的记忆条目 ID' },
          content: { type: 'string', description: '新增、更新或摘要内容' }
        },
        required: ['action']
      }
    },
    async (input, context) => {
      const value = input as { action: 'add' | 'update' | 'delete' | 'save_session_summary'; scope?: MemoryScope; id?: string; content?: string }
      if (value.action === 'add') {
        const entry = await store.add(value.scope ?? 'workspace', required(value.content, '新增记忆缺少 content'))
        return { content: `已写入${entry.scope === 'user' ? '用户级' : '工作区'}长期记忆（ID: ${entry.id}）`, data: entry as unknown as JsonValue }
      }
      if (value.action === 'update') {
        const entry = await store.update(required(value.id, '更新记忆缺少 id'), required(value.content, '更新记忆缺少 content'))
        return { content: `已更新长期记忆（ID: ${entry.id}）`, data: entry as unknown as JsonValue }
      }
      if (value.action === 'delete') {
        const id = required(value.id, '删除记忆缺少 id')
        const deleted = await store.delete(id)
        return { content: deleted ? `已删除长期记忆（ID: ${id}）` : `未找到长期记忆（ID: ${id}）`, data: { id, deleted } }
      }
      const entry = await store.saveSessionSummary(
        context.sessionId,
        required(value.content, '保存会话摘要缺少 content'),
        value.scope ?? 'workspace'
      )
      return { content: `已保存当前会话摘要（ID: ${entry.id}）`, data: entry as unknown as JsonValue }
    }
  )
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message)
  return value
}
