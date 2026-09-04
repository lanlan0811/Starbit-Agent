import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBuiltinToolRegistry } from './builtin'
import { resolveAuthorizedPath } from './workspace'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'starbit-tools-'))
  roots.push(root)
  return root
}

describe('内置工具', () => {
  it('拒绝越过工作区边界', async () => {
    const root = await workspace()
    expect(() => resolveAuthorizedPath(root, '..')).toThrow('路径超出已授权范围')
  })

  it('支持写入、精确编辑、读取和搜索', async () => {
    const root = await workspace()
    const registry = createBuiltinToolRegistry({ shell: { executable: process.execPath, args: ['-e'] } })
    const context = { workspacePath: root, sessionId: 's', toolCallId: 't', mode: 'fullAccess' }
    await registry.execute('Write', { path: 'docs/计划.md', content: 'alpha\nbeta\n' }, context)
    await registry.execute('Edit', { path: 'docs/计划.md', oldText: 'beta', newText: 'gamma' }, context)
    const read = await registry.execute('Read', { path: 'docs/计划.md' }, context)
    const grep = await registry.execute('Grep', { path: '.', query: 'gamma', include: '**/*.md' }, context)
    expect(read.content).toContain('gamma')
    expect(grep.content).toContain('docs/计划.md:2:gamma')
    expect(await readFile(join(root, 'docs', '计划.md'), 'utf8')).toContain('gamma')
  })
})
