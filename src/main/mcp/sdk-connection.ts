import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { Transport } from '@modelcontextprotocol/client'
import type { McpCallResult, McpConnection, McpServerConfig, McpToolInfo } from './types'

export class SdkMcpConnection implements McpConnection {
  private client: Client | null = null

  constructor(private readonly config: McpServerConfig) {}

  async connect(onToolsChanged: (tools: McpToolInfo[]) => void): Promise<void> {
    const connectWith = async (transport: Transport): Promise<Client> => {
      const client = new Client(
        { name: 'starbit', version: '0.1.0' },
        {
          versionNegotiation: { mode: 'auto', probe: { timeoutMs: 5000, maxRetries: 0 } },
          listChanged: {
            tools: {
              onChanged: (error, tools) => {
                if (!error && tools) onToolsChanged(normalizeTools(tools))
              }
            }
          }
        }
      )
      await client.connect(transport, { timeout: 15000 })
      return client
    }

    try {
      this.client = await connectWith(createTransport(this.config))
    } catch (error) {
      if (this.config.transport.type !== 'streamable-http' || this.config.transport.fallbackToSse === false) throw error
      await this.client?.close().catch(() => undefined)
      this.client = await connectWith(createSseTransport(this.config.transport.url, this.config.transport.headers))
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.client) throw new Error(`MCP ${this.config.name} 尚未连接`)
    const result = await this.client.listTools(undefined, { cacheMode: 'refresh' })
    return normalizeTools(result.tools)
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    if (!this.client) throw new Error(`MCP ${this.config.name} 尚未连接`)
    const result = await this.client.callTool({ name, arguments: args }, signal ? { signal } : undefined)
    return {
      content: result.content as unknown[],
      structuredContent: result.structuredContent,
      isError: result.isError
    }
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}

function createTransport(config: McpServerConfig): Transport {
  const transport = config.transport
  if (transport.type === 'stdio') {
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args,
      cwd: transport.cwd,
      env: safeEnvironment(transport.env),
      stderr: 'pipe'
    })
  }
  if (transport.type === 'sse') return createSseTransport(transport.url, transport.headers)
  return new StreamableHTTPClientTransport(new URL(transport.url), {
    requestInit: { headers: transport.headers }
  })
}

function createSseTransport(url: string, headers?: Record<string, string>): SSEClientTransport {
  return new SSEClientTransport(new URL(url), {
    requestInit: { headers },
    eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...headers, ...headersFrom(init?.headers) } }) }
  })
}

function headersFrom(headers: RequestInit['headers']): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

function safeEnvironment(configured: Record<string, string> = {}): Record<string, string> {
  const inherited = ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']
  const base = Object.fromEntries(inherited.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])))
  return { ...base, ...configured }
}

function normalizeTools(tools: Array<{ name: string; title?: string; description?: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>): McpToolInfo[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema as McpToolInfo['inputSchema'],
    annotations: tool.annotations
  }))
}
