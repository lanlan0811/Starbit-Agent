import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('并行子代理回传摘要后主代理收尾，运行中可取消', async () => {
  test.setTimeout(120_000)
  const userDataDir = await mkdtemp(join(tmpdir(), 'starbit-task-e2e-'))
  const received: Array<Record<string, unknown>> = []
  const subRequestCounts = new Map<string, number>()
  let mainRequests = 0
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const parsed = JSON.parse(body) as Record<string, unknown>
    received.push(parsed)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (payload: Record<string, unknown>): void => {
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    const end = (): void => {
      send({ usage: { prompt_tokens: 2000, prompt_tokens_details: { cached_tokens: 1950 }, completion_tokens: 30 } })
      response.end('data: [DONE]\n\n')
    }
    const cacheKey = String(parsed.prompt_cache_key ?? '')
    if (cacheKey.startsWith('subagent')) {
      const count = (subRequestCounts.get(cacheKey) ?? 0) + 1
      subRequestCounts.set(cacheKey, count)
      if (count === 1) {
        // 每个子代理的首轮：读取工作区文件
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `read-${cacheKey.slice(-4)}`, function: { name: 'Read', arguments: JSON.stringify({ path: 'e2e-sub.txt' }) } }] } }] })
      } else {
        // 次轮：回传摘要（此时消息里已带 Read 结果）
        send({ choices: [{ delta: { content: '子代理摘要完成' } }] })
      }
      end()
      return
    }
    mainRequests += 1
    if (mainRequests === 1) {
      // 主代理首轮：单次 Task 调用并行派生 explore + general 两个子代理
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'task-1', function: { name: 'Task', arguments: JSON.stringify({
        tasks: [
          { prompt: '检查工作区文件', type: 'explore' },
          { prompt: '总结工作区内容', type: 'general-purpose' }
        ]
      }) } }] } }] })
      end()
    } else if (mainRequests === 2) {
      send({ choices: [{ delta: { content: '并行子代理完成' } }] })
      end()
    } else {
      // 第三次主请求：挂起以验证运行中取消
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      try {
        send({ choices: [{ delta: { content: '不应出现' } }] })
      } catch { /* 客户端已断开 */ }
      end()
    }
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
      await api.models.save({ ...template, id: 'e2e-task-model', name: 'E2E Task Model', vendor: 'Local Test', custom: true,
        baseURL: endpoint, apiKeyRequired: false, usageCacheScope: 'nested', usageCachedTokensPath: 'cached_tokens',
        thinking: { low: { params: {} }, high: { params: {} }, max: { params: {} } } })
      await api.session.create(workspace, { title: '子代理实测', model: 'e2e-task-model', mode: 'fullAccess' })
    }, { workspace: userDataDir, endpoint: `http://127.0.0.1:${address.port}/v1` })
    await writeFile(join(userDataDir, 'e2e-sub.txt'), '子代理要读的内容', 'utf8')
    await window.reload()
    const input = window.getByPlaceholder('描述你的任务，支持 /命令 和 @文件...')
    await input.fill('并行研究工作区')
    await window.getByTitle('发送', { exact: true }).click()
    await expect(window.getByText('并行子代理完成', { exact: true })).toBeVisible({ timeout: 60_000 })

    // 两个子代理各自完成 initialize 后的两轮请求
    expect(mainRequests).toBe(2)
    expect(subRequestCounts.size).toBe(2)
    for (const count of subRequestCounts.values()) expect(count).toBe(2)
    // 主代理第二轮消息包含 Task 工具结果（两个子代理的摘要）
    const secondMain = received.filter((body) => !String(body.prompt_cache_key ?? '').startsWith('subagent'))[1]
    const toolMessages = (secondMain.messages as Array<{ role: string; content: string }>).filter((message) => message.role === 'tool')
    expect(toolMessages.some((message) => message.content.includes('子代理 1') && message.content.includes('子代理摘要完成'))).toBe(true)
    // 子代理第二轮消息包含 Read 工具结果（按 cacheKey 分组取各自第二条请求）
    const subBodies = received.filter((body) => String(body.prompt_cache_key ?? '').startsWith('subagent'))
    const secondPerKey = new Map<string, Record<string, unknown>>()
    for (const body of subBodies) {
      const key = String(body.prompt_cache_key)
      secondPerKey.set(key, body) // 后写覆盖，最终保留每个键的第二条
    }
    expect(secondPerKey.size).toBe(2)
    for (const body of secondPerKey.values()) {
      expect((body.messages as Array<{ role: string; content: string }>).some((message) => message.role === 'tool' && message.content.includes('子代理要读的内容'))).toBe(true)
    }

    // 运行中取消：主请求挂起 30s，点击停止后状态回到空闲
    await input.fill('取消这条任务')
    await window.getByTitle('发送', { exact: true }).click()
    await expect(window.getByText('运行中')).toBeVisible()
    await window.getByTitle('停止 (Esc)', { exact: true }).click()
    await expect(window.getByText('空闲')).toBeVisible({ timeout: 10_000 })
    expect(mainRequests).toBe(3)
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(userDataDir, { recursive: true, force: true })
  }
})
