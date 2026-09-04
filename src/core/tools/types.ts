import { z } from 'zod'
import type { JsonValue } from '../types'

/**
 * 工具定义 —— 统一 Zod schema。
 * 内置工具 ∪ MCP 工具 ∪ Skill 工具，全部归一化为该形态，按权限模式过滤。
 */

/** 工具参数 schema（Zod） */
export type ToolInputSchema = z.ZodTypeAny

/** 权限模式标签（决定该工具在哪些模式下可用） */
export type ToolMode = 'plan' | 'acceptEdits' | 'fullAccess'

/** 工具种类（用于权限/展示/策略分派） */
export type ToolKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'search'
  | 'shell'
  | 'plan'
  | 'task'
  | 'sandbox'
  | 'browser'
  | 'kb'
  | 'memory'
  | 'mcp'
  | 'skill'

export interface ToolDefinition {
  name: string
  description: string
  /** 入口 schema（input 校验） */
  inputSchema: ToolInputSchema
  /** 传给 OpenAI 兼容端点的 JSON Schema；与 inputSchema 保持一致 */
  inputJsonSchema: JsonValue
  /** 权限种类 */
  kind: ToolKind
  /** 仅只读（可并行安全执行） */
  readOnly?: boolean
  /** 危险度（0 普通，1 需确认，2 危险需强确认） */
  dangerLevel?: 0 | 1 | 2
  /** 语义标签用于权限规则匹配，如 'Write' / 'Bash' / 'Edit' */
  semanticLabel: string
  /** 默认超时（ms） */
  timeoutMs?: number
  /** 源：builtin / mcp:<server> / skill:<name> */
  source: string
  /** 命名空间分隔的完整工具名（如 mcp__filesystem__read_file） */
  fullName: string
}

/** 通用工具输入（宽松 JSON，运行时按 schema 校验） */
export type ToolInput = JsonValue

/** 工具执行上下文 */
export interface ToolContext {
  /** 工作区路径 */
  workspacePath: string
  /** 会话 ID */
  sessionId: string
  /** 工具调用 ID */
  toolCallId: string
  /** 当前权限模式 */
  mode: string
  /** 环境变量 */
  env?: Record<string, string>
  /** 用户显式授权的工作区外根目录 */
  grantedRoots?: string[]
  /** 子代理隔离标记 */
  isSubagent?: boolean
  /** 取消信号 */
  signal?: AbortSignal
}

/** 工具执行结果 */
export interface ToolResult {
  /** 可展示的字符串结果 */
  content: string
  /** 结构化数据 */
  data?: JsonValue
  /** 是否被截断 */
  truncated?: boolean
  /** 大输出落盘路径 */
  outputFile?: string
  /** 是否属于 untrusted 数据（需 <untrusted-data> 包裹） */
  untrusted?: boolean
}

/** 工具执行器 */
export type ToolExecutor = (input: ToolInput, ctx: ToolContext) => Promise<ToolResult>
