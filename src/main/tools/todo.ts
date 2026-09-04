import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { JsonValue } from '@core/types'
import { resolveAuthorizedPath } from './workspace'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  notes?: string
}

const itemSchema = z.object({
  id: z.string().min(1).max(128),
  content: z.string().min(1).max(4_000),
  status: z.enum(['pending', 'in_progress', 'completed']),
  notes: z.string().max(8_000).optional()
})

export function registerTodoTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'TodoWrite',
      fullName: 'TodoWrite',
      description: '替换当前会话的结构化任务清单；可同步到工作区内名称含“计划”或“plan”的 Markdown 计划文档。',
      kind: 'plan',
      readOnly: false,
      dangerLevel: 0,
      semanticLabel: 'TodoWrite',
      source: 'builtin',
      timeoutMs: 10_000,
      inputSchema: z.object({
        todos: z.array(itemSchema).max(200),
        planPath: z.string().min(1).optional()
      }),
      inputJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                notes: { type: 'string' }
              },
              required: ['id', 'content', 'status']
            }
          },
          planPath: { type: 'string', description: '可选的计划 Markdown 路径' }
        },
        required: ['todos']
      }
    },
    async (input, context) => {
      const value = input as unknown as { todos: TodoItem[]; planPath?: string }
      validateTodos(value.todos)
      const statePath = resolveAuthorizedPath(context.workspacePath, join('.starbit', 'todos', `${safeSessionId(context.sessionId)}.json`))
      let planPath: string | undefined
      if (value.planPath) {
        planPath = resolveAuthorizedPath(context.workspacePath, value.planPath)
        if (!/[\\/][^\\/]*(计划|plan)[^\\/]*\.md$/i.test(planPath)) throw new Error('planPath 必须是名称含“计划”或“plan”的 Markdown 文档')
        await mkdir(dirname(planPath), { recursive: true })
        let existing = ''
        try { existing = await readFile(planPath, 'utf8') } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
        }
        await writeFile(planPath, mergePlan(existing, value.todos), 'utf8')
      }
      await mkdir(dirname(statePath), { recursive: true })
      await writeFile(statePath, `${JSON.stringify({ version: 1, updatedAt: Date.now(), todos: value.todos }, null, 2)}\n`, 'utf8')
      const counts = countStatuses(value.todos)
      return {
        content: `任务清单已更新：待处理 ${counts.pending}，进行中 ${counts.in_progress}，已完成 ${counts.completed}${planPath ? `；计划文档 ${planPath}` : ''}`,
        data: { todos: value.todos, statePath, ...(planPath ? { planPath } : {}) } as unknown as JsonValue
      }
    }
  )

  registry.register(
    {
      name: 'TodoRead',
      fullName: 'TodoRead',
      description: '读取当前会话的结构化任务清单。',
      kind: 'plan',
      readOnly: true,
      dangerLevel: 0,
      semanticLabel: 'TodoRead',
      source: 'builtin',
      timeoutMs: 5_000,
      inputSchema: z.object({}),
      inputJsonSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    async (_input, context) => {
      const statePath = resolveAuthorizedPath(context.workspacePath, join('.starbit', 'todos', `${safeSessionId(context.sessionId)}.json`))
      try {
        const content = await readFile(statePath, 'utf8')
        return { content, data: JSON.parse(content) as JsonValue }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { content: '当前会话尚无任务清单。', data: { todos: [] } }
        throw error
      }
    }
  )
}

function validateTodos(todos: TodoItem[]): void {
  const ids = new Set<string>()
  let inProgress = 0
  for (const todo of todos) {
    if (ids.has(todo.id)) throw new Error(`任务 ID 重复: ${todo.id}`)
    ids.add(todo.id)
    if (todo.status === 'in_progress') inProgress += 1
  }
  if (inProgress > 1) throw new Error('同一时间最多只能有一个进行中的任务')
}

function renderPlan(todos: TodoItem[]): string {
  const lines = ['# 任务计划', '', '> 由衔星 TodoWrite 同步维护。', '']
  for (const todo of todos) {
    const check = todo.status === 'completed' ? 'x' : ' '
    const status = todo.status === 'in_progress' ? '（进行中）' : ''
    lines.push(`- [${check}] ${todo.content}${status}`)
    if (todo.notes?.trim()) lines.push(`  - ${todo.notes.trim().replace(/\r?\n/g, '\n  - ')}`)
  }
  return `${lines.join('\n')}\n`
}

function mergePlan(existing: string, todos: TodoItem[]): string {
  const start = '<!-- starbit-todos:start -->'
  const end = '<!-- starbit-todos:end -->'
  const managed = `${start}\n${renderPlan(todos)}${end}`
  const startIndex = existing.indexOf(start)
  const endIndex = existing.indexOf(end, startIndex + start.length)
  if (startIndex >= 0 && endIndex >= 0) return `${existing.slice(0, startIndex)}${managed}${existing.slice(endIndex + end.length)}`
  return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${managed}\n`
}

function countStatuses(todos: TodoItem[]): Record<TodoStatus, number> {
  const result: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0 }
  for (const todo of todos) result[todo.status] += 1
  return result
}

function safeSessionId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('会话 ID 无效')
  return value
}
