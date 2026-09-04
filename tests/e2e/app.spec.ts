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
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
