import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '@core/tools/registry'
import { PermissionService } from '@core/permission'
import { registerSandboxTools } from './sandbox'
import { registerTaskTools } from './task'
import { registerTodoTools } from './todo'
import { runBoundedProcess } from './process'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function context(root: string, call = 'call-1') {
  return { workspacePath: root, sessionId: 'session-1', toolCallId: call, mode: 'fullAccess' }
}

describe('M4 built-in tools', () => {
  it('同步待办保留原计划正文，非法目标不产生待办文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-todo-preserve-'))
    roots.push(root)
    const registry = new ToolRegistry()
    registerTodoTools(registry)
    await writeFile(join(root, 'plan.md'), '# 原始设计\n保留此段\n', 'utf8')
    const todos = [{ id: '1', content: '验证', status: 'pending' }]
    await registry.execute('TodoWrite', { todos, planPath: 'plan.md' }, context(root))
    await registry.execute('TodoWrite', { todos: [{ ...todos[0], status: 'completed' }], planPath: 'plan.md' }, context(root))
    const plan = await readFile(join(root, 'plan.md'), 'utf8')
    expect(plan).toContain('# 原始设计\n保留此段')
    expect(plan.match(/starbit-todos:start/g)).toHaveLength(1)
    const otherSession = { ...context(root), sessionId: 'other' }
    await expect(registry.execute('TodoWrite', { todos, planPath: 'code.ts' }, otherSession)).rejects.toThrow('planPath')
    await expect(readFile(join(root, '.starbit/todos/other.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('进程超时和输出超限会终止执行，提前取消不会启动进程', async () => {
    const options = { executable: process.execPath, cwd: process.cwd(), timeoutMs: 5000 }
    await expect(runBoundedProcess({ ...options, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 100 })).rejects.toThrow('超时')
    await expect(runBoundedProcess({ ...options, args: ['-e', 'console.log("x".repeat(10000))'], maxOutputBytes: 100 })).rejects.toThrow('输出超过上限')
    await expect(async () => runBoundedProcess({ ...options, args: ['-e', 'process.exit(0)'], signal: AbortSignal.abort() })).rejects.toThrow()
  })
  it('TodoWrite 持久化清单并同步计划文档', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-todo-'))
    roots.push(root)
    const registry = new ToolRegistry()
    registerTodoTools(registry)
    await registry.execute('TodoWrite', {
      todos: [
        { id: '1', content: '实现功能', status: 'completed' },
        { id: '2', content: '验证测试', status: 'in_progress' }
      ],
      planPath: 'docs/实施计划.md'
    }, context(root))
    expect(await readFile(join(root, 'docs', '实施计划.md'), 'utf8')).toContain('- [x] 实现功能')
    const state = await registry.execute('TodoRead', {}, context(root, 'call-2'))
    expect(state.content).toContain('验证测试')
  })

  it('Task 并行调用子代理并合并摘要', async () => {
    const registry = new ToolRegistry()
    const spawn = vi.fn(async (request: { prompt: string; type: 'explore' | 'general-purpose' }) => ({ id: request.prompt, type: request.type, summary: `完成 ${request.prompt}` }))
    registerTaskTools(registry, spawn)
    const result = await registry.execute('Task', {
      tasks: [
        { prompt: '检查 A', type: 'explore' },
        { prompt: '检查 B', type: 'explore' }
      ]
    }, context(process.cwd()))
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(result.content).toContain('完成 检查 A')
    expect(result.content).toContain('完成 检查 B')
  })

  it('NodeSandbox 在临时目录执行并清理脚本', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-sandbox-'))
    roots.push(root)
    const registry = new ToolRegistry()
    registerSandboxTools(registry, { nodeExecutable: process.execPath })
    const result = await registry.execute('NodeSandbox', { code: 'console.log("sandbox-ok")' }, context(root))
    expect(result.content).toContain('sandbox-ok')
    expect(await readdir(join(root, '.starbit', 'sandbox'))).toEqual([])
  })

  it('计划模式允许 TodoWrite', () => {
    const registry = new ToolRegistry()
    registerTodoTools(registry)
    const permissions = new PermissionService()
    permissions.setMode('plan')
    const tool = registry.get('TodoWrite')!
    expect(permissions.decide({ tool, semanticLabel: tool.semanticLabel, subject: 'TodoWrite', mode: 'plan' }).verdict).toBe('allow')
  })
})
