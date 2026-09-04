import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { JsonValue } from '@core/types'
import type { ToolContext } from '@core/tools/types'

export type SubagentType = 'explore' | 'general-purpose'

export interface SubagentRequest {
  prompt: string
  type: SubagentType
  allowedTools?: string[]
}

export interface SubagentResult {
  id: string
  type: SubagentType
  summary: string
}

export type SubagentSpawner = (request: SubagentRequest, context: ToolContext) => Promise<SubagentResult>

export function registerTaskTools(registry: ToolRegistry, spawn: SubagentSpawner): void {
  registry.register(
    {
      name: 'Task',
      fullName: 'Task',
      description: '并行派生 1 到 8 个独立上下文子代理。explore 仅可读；general-purpose 继承当前权限。每个子代理使用独立缓存键，只回传摘要。',
      kind: 'task',
      readOnly: false,
      dangerLevel: 1,
      semanticLabel: 'Task',
      source: 'builtin',
      timeoutMs: 10 * 60_000,
      inputSchema: z.object({
        tasks: z.array(z.object({
          prompt: z.string().min(1).max(100_000),
          type: z.enum(['explore', 'general-purpose']).default('explore'),
          allowedTools: z.array(z.string().min(1)).max(64).optional()
        })).min(1).max(8)
      }),
      inputJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                prompt: { type: 'string' },
                type: { type: 'string', enum: ['explore', 'general-purpose'] },
                allowedTools: { type: 'array', items: { type: 'string' }, maxItems: 64 }
              },
              required: ['prompt', 'type']
            }
          }
        },
        required: ['tasks']
      }
    },
    async (input, context) => {
      const value = input as unknown as { tasks: SubagentRequest[] }
      const results = await Promise.all(value.tasks.map((task) => spawn(task, context)))
      return {
        content: results.map((result, index) => `## 子代理 ${index + 1} · ${result.type}\n${result.summary}`).join('\n\n'),
        data: results as unknown as JsonValue
      }
    }
  )
}
