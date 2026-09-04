import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAuthorizedPath } from './workspace'

describe('workspace boundaries', () => {
  it('阻止通过工作区联接读写外部路径，同时允许显式授权', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-boundary-'))
    try {
      const workspace = join(root, 'workspace')
      const outside = join(root, 'outside')
      await mkdir(workspace)
      await mkdir(outside)
      await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      expect(() => resolveAuthorizedPath(workspace, 'escape/new.txt')).toThrow('授权范围外')
      expect(resolveAuthorizedPath(workspace, 'escape/new.txt', [outside])).toBe(join(workspace, 'escape/new.txt'))
      expect(resolveAuthorizedPath(workspace, '..notes/new.txt')).toBe(join(workspace, '..notes/new.txt'))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
