import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { ToolContext, ToolDefinition, ToolResult } from '@core/tools/types'
import { limitToolOutput } from './output'
import { resolveAuthorizedPath } from './workspace'
import { runBoundedProcess } from './process'
import { unifiedDiff } from './diff'

type InputRecord = Record<string, unknown>

const COMMON_SCHEMA = { type: 'object', additionalProperties: false } as const

export interface ShellSettings {
  executable: string
  args: string[]
}

export interface BuiltinToolOptions {
  shell: ShellSettings
  maxOutputBytes?: number
}

export function createBuiltinToolRegistry(options: BuiltinToolOptions): ToolRegistry {
  const registry = new ToolRegistry()
  const register = (def: ToolDefinition, execute: (input: InputRecord, ctx: ToolContext) => Promise<ToolResult>): void => {
    registry.register(def, (input, ctx) => execute(input as InputRecord, ctx))
  }

  register(
    definition('Read', '读取 UTF-8 文本文件，可按行分页。', 'read', true, 'Read', z.object({ path: z.string().min(1), offset: z.number().int().min(0).optional(), limit: z.number().int().positive().max(10000).optional() }), {
      ...COMMON_SCHEMA,
      properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 10000 } },
      required: ['path']
    }),
    async (input, ctx) => {
      const target = authorized(ctx, String(input.path))
      const text = await readFile(target, 'utf8')
      const lines = text.split(/\r?\n/)
      const offset = numberValue(input.offset, 0)
      const limit = numberValue(input.limit, 2000)
      const selected = lines.slice(offset, offset + limit).map((line, index) => `${offset + index + 1}: ${line}`).join('\n')
      return limitToolOutput(selected, ctx.workspacePath, ctx.toolCallId, options.maxOutputBytes)
    }
  )

  register(
    definition('Write', '写入 UTF-8 文件；自动创建父目录。', 'write', false, 'Write', z.object({ path: z.string().min(1), content: z.string() }), {
      ...COMMON_SCHEMA,
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }),
    async (input, ctx) => {
      const target = authorized(ctx, String(input.path))
      await mkdir(dirname(target), { recursive: true })
      const content = String(input.content)
      const previous = await readFile(target, 'utf8').catch(() => null)
      await writeFile(target, content, 'utf8')
      return {
        content: previous === null ? `已创建 ${target}（${Buffer.byteLength(content, 'utf8')} 字节）` : `已覆盖写入 ${target}（${Buffer.byteLength(content, 'utf8')} 字节）`,
        diff: unifiedDiff(previous ?? '', content)
      }
    }
  )

  register(
    definition('Edit', '通过精确文本匹配编辑 UTF-8 文件。', 'edit', false, 'Edit', z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string(), replaceAll: z.boolean().optional() }), {
      ...COMMON_SCHEMA,
      properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } },
      required: ['path', 'oldText', 'newText']
    }),
    async (input, ctx) => {
      const target = authorized(ctx, String(input.path))
      const source = await readFile(target, 'utf8')
      const oldText = String(input.oldText)
      const count = source.split(oldText).length - 1
      if (count === 0) throw new Error(`未在 ${target} 找到待替换文本`)
      if (count > 1 && input.replaceAll !== true) throw new Error(`待替换文本在 ${target} 中出现 ${count} 次，请扩大上下文或设置 replaceAll`)
      const next = input.replaceAll === true ? source.split(oldText).join(String(input.newText)) : source.replace(oldText, String(input.newText))
      await writeFile(target, next, 'utf8')
      return {
        content: `已编辑 ${target}（替换 ${input.replaceAll === true ? count : 1} 处）`,
        diff: unifiedDiff(source, next)
      }
    }
  )

  register(
    definition('Mkdir', '在授权范围内创建文件夹。', 'write', false, 'Mkdir', z.object({ path: z.string().min(1) }), {
      ...COMMON_SCHEMA,
      properties: { path: { type: 'string' } }, required: ['path']
    }),
    async (input, ctx) => {
      const target = authorized(ctx, String(input.path))
      await mkdir(target, { recursive: true })
      return { content: `已创建目录 ${target}` }
    }
  )

  register(
    definition('LS', '列出目录内容和基本类型。', 'read', true, 'LS', z.object({ path: z.string().optional(), depth: z.number().int().min(1).max(8).optional() }), {
      ...COMMON_SCHEMA,
      properties: { path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 8 } }
    }),
    async (input, ctx) => {
      const target = authorized(ctx, typeof input.path === 'string' ? input.path : '.')
      const entries: string[] = []
      await walk(target, numberValue(input.depth, 1), async (path, isDirectory) => {
        entries.push(`${isDirectory ? '目录' : '文件'}\t${relative(target, path) || basename(path)}`)
      })
      return limitToolOutput(entries.join('\n'), ctx.workspacePath, ctx.toolCallId, options.maxOutputBytes)
    }
  )

  register(
    definition('Glob', '按 glob 模式搜索工作区文件。', 'search', true, 'Glob', z.object({ pattern: z.string().min(1), path: z.string().optional(), limit: z.number().int().positive().max(10000).optional() }), {
      ...COMMON_SCHEMA,
      properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10000 } },
      required: ['pattern']
    }),
    async (input, ctx) => {
      const root = authorized(ctx, typeof input.path === 'string' ? input.path : '.')
      const matcher = globMatcher(String(input.pattern))
      const matches: string[] = []
      const limit = numberValue(input.limit, 2000)
      await walk(root, 32, async (path, isDirectory) => {
        if (!isDirectory && matches.length < limit) {
          const candidate = relative(root, path).replace(/\\/g, '/')
          if (matcher.test(candidate)) matches.push(candidate)
        }
      })
      return { content: matches.join('\n'), data: matches }
    }
  )

  register(
    definition('Grep', '用正则表达式搜索 UTF-8 文本文件。', 'search', true, 'Grep', z.object({ query: z.string().min(1), path: z.string().optional(), include: z.string().optional(), caseSensitive: z.boolean().optional(), limit: z.number().int().positive().max(10000).optional() }), {
      ...COMMON_SCHEMA,
      properties: { query: { type: 'string' }, path: { type: 'string' }, include: { type: 'string' }, caseSensitive: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 10000 } },
      required: ['query']
    }),
    async (input, ctx) => {
      const root = authorized(ctx, typeof input.path === 'string' ? input.path : '.')
      const expression = new RegExp(String(input.query), input.caseSensitive === true ? '' : 'i')
      const include = typeof input.include === 'string' ? globMatcher(input.include) : null
      const matches: string[] = []
      const limit = numberValue(input.limit, 2000)
      await walk(root, 32, async (path, isDirectory) => {
        if (isDirectory || matches.length >= limit) return
        const displayPath = relative(root, path).replace(/\\/g, '/')
        if (include && !include.test(displayPath)) return
        let content: string
        try {
          content = await readFile(path, 'utf8')
        } catch {
          return
        }
        if (content.includes('\0')) return
        for (const [index, line] of content.split(/\r?\n/).entries()) {
          if (expression.test(line)) matches.push(`${displayPath}:${index + 1}:${line}`)
          expression.lastIndex = 0
          if (matches.length >= limit) break
        }
      })
      return limitToolOutput(matches.join('\n'), ctx.workspacePath, ctx.toolCallId, options.maxOutputBytes)
    }
  )

  register(
    definition('Bash', '在工作区内使用用户配置的 Shell 执行命令。', 'shell', false, 'Bash', z.object({ command: z.string().min(1), timeoutMs: z.number().int().positive().max(600000).optional() }), {
      ...COMMON_SCHEMA,
      properties: { command: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1, maximum: 600000 } },
      required: ['command']
    }, 1),
    async (input, ctx) => runShell(String(input.command), numberValue(input.timeoutMs, 120000), ctx, options)
  )

  return registry
}

function definition(
  name: string,
  description: string,
  kind: ToolDefinition['kind'],
  readOnly: boolean,
  semanticLabel: string,
  inputSchema: ToolDefinition['inputSchema'],
  inputJsonSchema: ToolDefinition['inputJsonSchema'],
  dangerLevel: 0 | 1 | 2 = 0
): ToolDefinition {
  return { name, fullName: name, description, kind, readOnly, semanticLabel, inputSchema, inputJsonSchema, dangerLevel, source: 'builtin' }
}

function authorized(ctx: ToolContext, path: string): string {
  return resolveAuthorizedPath(ctx.workspacePath, path, ctx.grantedRoots)
}

async function walk(root: string, maxDepth: number, visit: (path: string, isDirectory: boolean) => Promise<void>): Promise<void> {
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()!
    let children
    try {
      children = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      if (child.name === 'node_modules' || child.name === '.git') continue
      const path = resolveAuthorizedPath(root, join(current.path, child.name))
      await visit(path, child.isDirectory())
      if (child.isDirectory() && current.depth + 1 < maxDepth) queue.push({ path, depth: current.depth + 1 })
    }
  }
}

function globMatcher(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (char === '*' && normalized[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

async function runShell(command: string, timeoutMs: number, ctx: ToolContext, options: BuiltinToolOptions): Promise<ToolResult> {
  await stat(ctx.workspacePath)
  const content = await runBoundedProcess({
    executable: options.shell.executable, args: [...options.shell.args, command],
    cwd: ctx.workspacePath, env: { ...process.env, ...ctx.env }, timeoutMs, signal: ctx.signal
  })
  return limitToolOutput(content || '命令执行成功，无输出。', ctx.workspacePath, ctx.toolCallId, options.maxOutputBytes)
}
