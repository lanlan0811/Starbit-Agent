import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStore } from './store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('MemoryStore', () => {
  it('管理用户级和工作区级记忆，同时保持 AGENTS.md 只读', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-memory-'))
    temporaryDirectories.push(root)
    const workspace = join(root, 'workspace')
    const userHome = join(root, 'user')
    const store = new MemoryStore({ workspacePath: workspace, userHome, idFactory: () => 'entry-1', now: () => 100 })
    await mkdir(workspace, { recursive: true })
    await writeFile(store.projectRulesPath, '# 规则\n只读项目规则', 'utf8')

    const entry = await store.add('workspace', '所有新代码使用严格 TypeScript。')
    expect(await store.search('严格 TypeScript')).toMatchObject([{ id: entry.id, scope: 'workspace' }])
    await store.update(entry.id, '所有新代码必须通过严格类型检查。')
    const context = await store.loadContext()
    expect(context.workspaceMemory).toContain('严格类型检查')
    expect(context.projectRules).toContain('只读项目规则')
    expect(await readFile(store.projectRulesPath, 'utf8')).toBe('# 规则\n只读项目规则')
    expect(await store.delete(entry.id)).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('为同一会话更新单一自动摘要', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-memory-summary-'))
    temporaryDirectories.push(root)
    const store = new MemoryStore({ workspacePath: join(root, 'workspace'), userHome: join(root, 'user') })
    const first = await store.saveSessionSummary('session-1', '初始摘要')
    const second = await store.saveSessionSummary('session-1', '更新摘要')
    expect(second.id).toBe(first.id)
    expect(await store.list('workspace')).toMatchObject([{ source: 'session', content: '更新摘要' }])
  })
})
