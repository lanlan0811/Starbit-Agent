import type { JsonValue } from '@core/types'

export type McpTransportConfig =
  | { type: 'stdio'; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  | { type: 'streamable-http'; url: string; headers?: Record<string, string>; fallbackToSse?: boolean }
  | { type: 'sse'; url: string; headers?: Record<string, string> }

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: McpTransportConfig
  disabledTools?: string[]
}

export interface McpToolInfo {
  name: string
  title?: string
  description?: string
  inputSchema: JsonValue
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
  }
}

export interface McpCallResult {
  content: unknown[]
  structuredContent?: unknown
  isError?: boolean
}

export interface McpServerState {
  config: McpServerConfig
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: McpToolInfo[]
  error?: string
}

export interface McpConnection {
  connect(onToolsChanged: (tools: McpToolInfo[]) => void): Promise<void>
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>
  close(): Promise<void>
}
