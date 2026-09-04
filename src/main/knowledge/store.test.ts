import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeStore } from './store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('KnowledgeStore', () => {
  it('导入、检索、重建并持久化本地文档索引', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-knowledge-'))
    temporaryDirectories.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const source = join(root, 'guide.md')
    await writeFile(source, '# 发布指南\n\n发布前必须运行类型检查与端到端测试。', 'utf8')

    const store = await KnowledgeStore.open({ workspacePath: workspace, embedding: { mode: 'local', dimensions: 64 } })
    const base = await store.createKnowledgeBase('工程资料')
    const document = await store.importDocument({ knowledgeBaseId: base.id, path: source })
    expect(document.status).toBe('indexed')
    expect(document.chunkCount).toBeGreaterThan(0)
    const hits = await store.search('发布前测试', { knowledgeBaseId: base.id })
    expect(hits[0]?.content).toContain('端到端测试')
    expect(await store.rebuildKnowledgeBase(base.id)).toHaveLength(1)
    await store.close()

    const reopened = await KnowledgeStore.open({ workspacePath: workspace, embedding: { mode: 'local', dimensions: 64 } })
    expect(await reopened.listDocuments(base.id)).toHaveLength(1)
    expect(await reopened.deleteDocument(document.id)).toBe(true)
    expect(await reopened.deleteKnowledgeBase(base.id)).toBe(true)
    await reopened.close()
  })
})
