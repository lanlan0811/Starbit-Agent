import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listWorkspaceFiles, readWorkspaceFilePreview } from './list'

describe('工作区文件列表', () => {
  it('返回扁平目录树并忽略依赖与构建目录', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'starbit-list-'))
    try {
      await mkdir(join(workspace, 'src', 'nested'), { recursive: true })
      await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'readme')
      await writeFile(join(workspace, 'src', 'index.ts'), 'export {}')
      await writeFile(join(workspace, 'src', 'nested', 'deep.txt'), 'deep')
      await writeFile(join(workspace, 'node_modules', 'pkg', 'index.js'), 'ignored')

      const entries = await listWorkspaceFiles(workspace)
      const paths = entries.map((entry) => entry.path)
      expect(paths).toContain('README.md')
      expect(paths).toContain('src/index.ts')
      expect(paths).toContain('src/nested')
      expect(paths).toContain('src/nested/deep.txt')
      expect(paths).not.toContain('node_modules')
      expect(paths.some((path) => path.startsWith('node_modules'))).toBe(false)
      const readme = entries.find((entry) => entry.path === 'README.md')
      expect(readme?.isDir).toBe(false)
      expect(readme?.size).toBe('readme'.length)
      expect((readme?.modifiedAt ?? 0)).toBeGreaterThan(0)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('受数量上限约束并跳过越界的目录联接', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'starbit-limit-'))
    try {
      await mkdir(join(workspace, 'outside'), { recursive: true })
      await writeFile(join(workspace, 'outside', 'secret.txt'), 'x')
      await symlink(join(workspace, 'outside'), join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      for (let i = 0; i < 6; i += 1) await writeFile(join(workspace, `f${i}.txt`), 'data')

      const limited = await listWorkspaceFiles(workspace, { maxEntries: 3 })
      expect(limited.length).toBeLessThanOrEqual(3)

      const all = await listWorkspaceFiles(workspace)
      expect(all.map((entry) => entry.path)).not.toContain('escape/secret.txt')
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('预览截断大文件并拒绝工作区外路径', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'starbit-preview-'))
    try {
      await writeFile(join(workspace, 'big.txt'), 'a'.repeat(200))
      await writeFile(join(workspace, 'binary.bin'), Buffer.from([1, 0, 1]))
      const preview = await readWorkspaceFilePreview(workspace, 'big.txt', 64)
      expect(preview.truncated).toBe(true)
      expect(preview.content.length).toBe(64)
      await expect(readWorkspaceFilePreview(workspace, 'binary.bin')).rejects.toThrow('二进制')
      await expect(readWorkspaceFilePreview(workspace, '../outside.txt')).rejects.toThrow('授权范围')
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
