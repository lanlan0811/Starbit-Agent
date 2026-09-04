import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IpcApi } from '../../src/main/ipc/types'
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

test('自定义模型经流式工具循环完成文件操作，并允许取消压缩', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'starbit-agent-e2e-'))
  const received: Array<Record<string, unknown>> = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    received.push(JSON.parse(body) as Record<string, unknown>)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (received.length === 1) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'write-result', function: { name: 'Write', arguments: JSON.stringify({ path: 'e2e-result.txt', content: '实际工具执行结果' }) } }] } }] })}\n\n`)
    } else {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '文件已写入，' } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '验证完成。' } }] })}\n\n`)
    }
    response.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 970 }, completion_tokens: 20 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const app = await electron.launch({ args: ['.'], env: { ...process.env, STARBIT_USER_DATA_DIR: userDataDir } })
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await window.evaluate(async ({ workspace, endpoint }) => {
      const api = (window as unknown as { starbit: IpcApi }).starbit
      const template = (await api.models.list())[0]
      await api.models.save({ ...template, id: 'e2e-model', name: 'E2E Model', vendor: 'Local Test', custom: true,
        baseURL: endpoint, apiKeyRequired: false, usageCacheScope: 'nested', usageCachedTokensPath: 'cached_tokens',
        thinking: { low: { params: {} }, high: { params: {} }, max: { params: {} } } })
      await api.session.create(workspace, { title: 'Agent 实测', model: 'e2e-model', mode: 'fullAccess' })
    }, { workspace: userDataDir, endpoint: `http://127.0.0.1:${address.port}/v1` })
    await window.reload()
    const input = window.getByPlaceholder('描述你的任务，支持 /命令 和 @文件...')
    await input.fill('创建 e2e-result.txt')
    await window.getByTitle('发送', { exact: true }).click()
    await expect(window.getByText('文件已写入，验证完成。', { exact: true })).toBeVisible()
    expect(await readFile(join(userDataDir, 'e2e-result.txt'), 'utf8')).toBe('实际工具执行结果')
    expect(received).toHaveLength(2)
    expect((received[1].messages as Array<{ role: string; content: string }>).some((message) => message.role === 'tool' && message.content.includes('e2e-result.txt'))).toBe(true)
    await input.fill('/compact')
    await window.getByTitle('发送', { exact: true }).click()
    await expect(window.getByRole('dialog', { name: '上下文即将压缩' })).toBeVisible()
    await window.getByRole('button', { name: '取消', exact: true }).click()
    await expect(window.getByRole('dialog', { name: '上下文即将压缩' })).toHaveCount(0)
    expect(received).toHaveLength(2)
    await window.reload()
    await expect(window.getByText('文件已写入，验证完成。', { exact: true })).toBeVisible()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(userDataDir, { recursive: true, force: true })
  }
})
