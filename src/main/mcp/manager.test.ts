import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '@core/tools/registry'
import { McpManager } from './manager'
import type { McpConnection, McpServerConfig, McpToolInfo } from './types'

class FakeConnection implements McpConnection {
  constructor(private readonly tools: McpToolInfo[]) {}
  async connect(_onToolsChanged: (tools: McpToolInfo[]) => void): Promise<void> {}
  async listTools(): Promise<McpToolInfo[]> { return this.tools }
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[] }> {
    return { content: [{ type: 'text', text: `${name}:${String(args.value)}` }] }
  }
  async close(): Promise<void> {}
}

describe('McpManager', () => {
  it('连接服务器并把 MCP 工具桥接到统一注册表', async () => {
    const config: McpServerConfig = { id: 'demo', name: 'demo server', enabled: true, transport: { type: 'stdio', command: 'unused' } }
    const manager = new McpManager(() => new FakeConnection([{ name: 'echo', description: '回显', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]))
    await manager.synchronize([config])
    expect(manager.states([config])[0].status).toBe('connected')
    const registry = new ToolRegistry()
    manager.registerTools(registry)
    const result = await registry.execute('mcp__demo_server__echo', { value: 1 }, { workspacePath: process.cwd(), sessionId: 's', toolCallId: 't', mode: 'plan' })
    expect(result.content).toBe('echo:1')
    expect(result.untrusted).toBe(true)
  })
})
