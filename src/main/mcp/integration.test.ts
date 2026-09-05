import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolRegistry } from '@core/tools/registry'
import { McpManager } from './manager'
import type { McpServerConfig } from './types'

/**
 * MCP stdio 集成测试：启动一个真实的 JSON-RPC over stdio 服务器子进程，
 * 经 SdkMcpConnection（initialize → tools/list → tools/call）走完整协议链路。
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const SERVER_SCRIPT = `
const replies = () => ({
  echo: (args) => ({ content: [{ type: 'text', text: 'echo:' + String(args.value) }] })
})
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id === undefined) continue // 通知（如 initialized）无需回应；id=0 是合法请求
    let result
    if (message.method === 'initialize') {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'integration-server', version: '1.0.0' }
      }
    } else if (message.method === 'tools/list') {
      result = {
        tools: [{
          name: 'echo',
          description: '回显输入',
          inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
          annotations: { readOnlyHint: true }
        }]
      }
    } else if (message.method === 'tools/call') {
      result = replies()[message.params.name](message.params.arguments)
    } else {
      result = {}
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  }
})
process.stdin.resume()
`

describe('MCP stdio 集成', () => {
  it('经真实子进程完成 initialize、tools/list 与 tools/call', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-mcp-'))
    roots.push(root)
    const scriptPath = join(root, 'server.mjs')
    await writeFile(scriptPath, SERVER_SCRIPT, 'utf8')

    const config: McpServerConfig = {
      id: 'integration',
      name: 'integration server',
      enabled: true,
      transport: { type: 'stdio', command: process.execPath, args: [scriptPath] }
    }
    const manager = new McpManager()
    try {
      await manager.synchronize([config])
      const state = manager.states([config])[0]
      expect(state.status).toBe('connected')
      expect(state.tools.map((tool) => tool.name)).toEqual(['echo'])

      const registry = new ToolRegistry()
      manager.registerTools(registry)
      const fullName = 'mcp__integration_server__echo'
      const result = await registry.execute(
        fullName,
        { value: 42 },
        { workspacePath: root, sessionId: 'session-1', toolCallId: 'call-1', mode: 'fullAccess' }
      )
      expect(result.content).toBe('echo:42')
      expect(result.untrusted).toBe(true)
    } finally {
      await manager.close()
    }
  })
})
