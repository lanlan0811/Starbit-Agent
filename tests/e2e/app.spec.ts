import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('启动工作台并展示核心界面', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'starbit-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      STARBIT_USER_DATA_DIR: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  })

  try {
    const window = await app.firstWindow()
    await expect(window).toHaveTitle('衔星 | Starbit')
    await expect(window.getByText('衔星 · Starbit 工作台')).toBeVisible()
    await expect(window.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await expect(window.getByPlaceholder('描述你的任务，支持 /命令 和 @文件...')).toBeVisible()
    await expect(window.getByText('完全访问')).toBeVisible()

    await window.evaluate(async (workspacePath) => {
      const api = (window as unknown as { starbit: { session: { create(path: string, options: unknown): Promise<unknown> } } }).starbit
      await api.session.create(workspacePath, { title: '终端测试', model: 'qwen3.8-max', mode: 'fullAccess' })
    }, userDataDir)
    await window.reload()
    await window.getByTitle('终端').click()
    await expect(window.getByLabel('终端面板')).toBeVisible()
    await expect(window.locator('.terminal-host .xterm')).toBeVisible()
    await expect(window.locator('.terminal-error')).toHaveCount(0)

    await window.getByTitle('浏览器').click()
    await expect(window.getByLabel('浏览器面板')).toBeVisible()
    await expect(window.getByLabel('浏览器地址')).toBeVisible()
    await expect(window.getByLabel('浏览器页面区域')).toBeVisible()

    await window.getByTitle('知识库').click()
    await expect(window.getByRole('complementary', { name: '知识库' })).toBeVisible()
    await window.getByLabel('新知识库名称').fill('E2E 知识库')
    await window.getByTitle('创建知识库').click()
    await expect(window.getByText('知识库已创建。')).toBeVisible()

    await window.getByTitle('记忆管理').click()
    await window.getByLabel('记忆内容').fill('偏好使用 TypeScript 严格模式。')
    await window.getByRole('button', { name: '添加', exact: true }).click()
    await expect(window.getByText('偏好使用 TypeScript 严格模式。')).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
