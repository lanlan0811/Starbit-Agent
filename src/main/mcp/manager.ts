import { z } from 'zod'
import { ToolRegistry } from '@core/tools/registry'
import type { ToolDefinition } from '@core/tools/types'
import { canonicalJson } from '../provider/canonical'
import { SdkMcpConnection } from './sdk-connection'
import type { McpCallResult, McpConnection, McpServerConfig, McpServerState, McpToolInfo } from './types'

export type McpConnectionFactory = (config: McpServerConfig) => McpConnection

interface ActiveConnection {
  connection: McpConnection
  fingerprint: string
  state: McpServerState
}

/** MCP 生命周期、崩溃重连和 ToolRegistry 桥接。工具变更只影响下一会话。 */
export class McpManager {
  private readonly active = new Map<string, ActiveConnection>()

  constructor(
    private readonly createConnection: McpConnectionFactory = (config) => new SdkMcpConnection(config),
    private readonly onStateChanged: (state: McpServerState) => void = () => undefined
  ) {}

  async synchronize(configs: McpServerConfig[]): Promise<void> {
    const desired = new Map(configs.map((config) => [config.id, config]))
    for (const [id, active] of this.active) {
      const config = desired.get(id)
      const fingerprint = config ? canonicalJson(config as unknown as import('@core/types').JsonValue) : ''
      if (!config?.enabled || fingerprint !== active.fingerprint || active.state.status === 'error') {
        await active.connection.close().catch(() => undefined)
        this.active.delete(id)
      }
    }
    await Promise.all(configs.filter((config) => config.enabled && !this.active.has(config.id)).map((config) => this.connect(config)))
  }

  states(configs: McpServerConfig[] = []): McpServerState[] {
    return configs.map((config) => {
      const state = this.active.get(config.id)?.state
      return state ? { ...state, config } : { config, status: 'disconnected', tools: [] }
    })
  }

  registerTools(registry: ToolRegistry): void {
    for (const active of this.active.values()) {
      if (active.state.status !== 'connected') continue
      const disabled = new Set(active.state.config.disabledTools ?? [])
      for (const tool of active.state.tools) {
        if (disabled.has(tool.name)) continue
        const definition = toToolDefinition(active.state.config, tool)
        registry.register(definition, async (input, context) => {
          const result = await this.callWithReconnect(active.state.config, tool.name, asArguments(input), context.signal)
          if (result.isError) throw new Error(formatMcpResult(result))
          return { content: formatMcpResult(result), data: toJsonValue(result.structuredContent), untrusted: true }
        })
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.active.values()].map((active) => active.connection.close().catch(() => undefined)))
    this.active.clear()
  }

  private async callWithReconnect(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallResult> {
    const current = this.active.get(config.id)
    if (!current) throw new Error(`MCP ${config.name} 尚未连接`)
    try {
      return await current.connection.callTool(toolName, args, signal)
    } catch (firstError) {
      await current.connection.close().catch(() => undefined)
      this.active.delete(config.id)
      await this.connect(config)
      const reconnected = this.active.get(config.id)
      if (!reconnected || reconnected.state.status !== 'connected') throw firstError
      return reconnected.connection.callTool(toolName, args, signal)
    }
  }

  private async connect(config: McpServerConfig): Promise<void> {
    const connection = this.createConnection(config)
    const state: McpServerState = { config, status: 'connecting', tools: [] }
    const active: ActiveConnection = {
      connection,
      fingerprint: canonicalJson(config as unknown as import('@core/types').JsonValue),
      state
    }
    this.active.set(config.id, active)
    this.emit(state)
    try {
      await connection.connect((tools) => {
        active.state = { ...active.state, tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)) }
        this.emit(active.state)
      })
      const tools = await connection.listTools()
      active.state = { config, status: 'connected', tools: tools.sort((a, b) => a.name.localeCompare(b.name)) }
      this.emit(active.state)
    } catch (error) {
      active.state = { config, status: 'error', tools: [], error: error instanceof Error ? error.message : String(error) }
      this.emit(active.state)
    }
  }

  private emit(state: McpServerState): void {
    this.onStateChanged({ ...state, tools: [...state.tools] })
  }
}

export function toToolDefinition(server: McpServerConfig, tool: McpToolInfo): ToolDefinition {
  const readOnly = tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true
  return {
    name: tool.title || tool.name,
    fullName: `mcp__${safeName(server.name || server.id)}__${safeName(tool.name)}`,
    description: tool.description || `调用 MCP ${server.name} 的 ${tool.name} 工具。`,
    inputSchema: z.record(z.unknown()),
    inputJsonSchema: tool.inputSchema,
    kind: 'mcp',
    readOnly,
    dangerLevel: tool.annotations?.destructiveHint ? 2 : readOnly ? 0 : 1,
    semanticLabel: `MCP:${server.id}:${tool.name}`,
    source: `mcp:${server.id}`
  }
}

function formatMcpResult(result: McpCallResult): string {
  const parts = result.content.map((part) => {
    if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text
    return JSON.stringify(part)
  })
  if (result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  return parts.filter(Boolean).join('\n') || 'MCP 工具执行完成，无输出。'
}

function asArguments(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toJsonValue(value: unknown): import('@core/types').JsonValue | undefined {
  try {
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as import('@core/types').JsonValue)
  } catch {
    return undefined
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}
