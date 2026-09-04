import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { ToolContext, ToolResult } from '@core/tools/types'
import type { ToolDefinition } from '@core/tools/types'
import type { JsonValue } from '@core/types'
import { limitToolOutput } from './output'
import { resolveAuthorizedPath } from './workspace'
import { runBoundedProcess } from './process'

export interface SandboxOptions {
  nodeExecutable?: string
  pythonExecutable?: string
  maxOutputBytes?: number
}

export function registerSandboxTools(registry: ToolRegistry, options: SandboxOptions = {}): void {
  const schema = z.object({ code: z.string().min(1).max(1_000_000), timeoutMs: z.number().int().min(100).max(120_000).optional() })
  const jsonSchema: JsonValue = {
    type: 'object',
    additionalProperties: false,
    properties: { code: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 100, maximum: 120000 } },
    required: ['code']
  }
  registry.register(
    definition('NodeSandbox', '在工作区受限临时目录中执行 Node.js 脚本，限制文件读写、子进程、超时和输出。', schema, jsonSchema),
    async (input, context) => executeSandbox('node', input as { code: string; timeoutMs?: number }, context, options)
  )
  registry.register(
    definition('PythonSandbox', '在工作区临时目录中以 Python 隔离导入模式执行脚本，限制超时和输出。非系统级文件隔离，执行须经权限引擎。', schema, jsonSchema),
    async (input, context) => executeSandbox('python', input as { code: string; timeoutMs?: number }, context, options)
  )
}

function definition(name: string, description: string, inputSchema: z.ZodTypeAny, inputJsonSchema: JsonValue): ToolDefinition {
  return {
    name,
    fullName: name,
    description,
    kind: 'sandbox' as const,
    readOnly: false,
    dangerLevel: 1 as const,
    semanticLabel: name,
    source: 'builtin',
    timeoutMs: 130_000,
    inputSchema,
    inputJsonSchema
  }
}

async function executeSandbox(
  runtime: 'node' | 'python',
  input: { code: string; timeoutMs?: number },
  context: ToolContext,
  options: SandboxOptions
): Promise<ToolResult> {
  context.signal?.throwIfAborted()
  const parent = resolveAuthorizedPath(context.workspacePath, join('.starbit', 'sandbox'))
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `${safeId(context.toolCallId)}-`))
  const script = join(root, runtime === 'node' ? 'main.mjs' : 'main.py')
  await writeFile(script, input.code, 'utf8')
  const timeoutMs = input.timeoutMs ?? 30_000
  try {
    const executable = runtime === 'node'
      ? options.nodeExecutable ?? process.execPath
      : options.pythonExecutable ?? (process.platform === 'win32' ? 'python.exe' : 'python3')
    const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
    const args = runtime === 'node'
      ? [permissionFlag, `--allow-fs-read=${root}`, `--allow-fs-write=${root}`, script]
      : ['-I', '-B', script]
    const environment = sandboxEnvironment(root, runtime)
    const output = await runBoundedProcess({ executable, args, cwd: root, env: environment, timeoutMs, signal: context.signal })
    return limitToolOutput(output || '脚本执行成功，无输出。', context.workspacePath, context.toolCallId, options.maxOutputBytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function sandboxEnvironment(root: string, runtime: 'node' | 'python'): NodeJS.ProcessEnv {
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  return {
    PATH: pathValue,
    SystemRoot: process.env.SystemRoot,
    TEMP: root,
    TMP: root,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ...(runtime === 'node' && process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  }
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('工具调用 ID 无效')
  return value
}
