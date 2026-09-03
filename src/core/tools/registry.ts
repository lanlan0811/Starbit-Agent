import type { SessionId, ToolCallId } from '../types'
import type { ToolDefinition, ToolExecutor, ToolInput, ToolResult, ToolContext } from './types'
import type { PermissionMode } from '../events'

/**
 * ToolRegistry —— 内置工具 ∪ MCP 工具 ∪ Skill 工具
 * 统一登记、按权限模式过滤、canonical 序列化（§3.6 规则 2：工具列表会话期冻结）。
 */

interface Registration {
  def: ToolDefinition
  executor: ToolExecutor
  enabled: boolean
}

export class ToolRegistry {
  private tools = new Map<string, Registration>()

  /** 注册一个工具 */
  register(def: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(def.fullName, { def, executor, enabled: true })
  }

  /** 注销 */
  unregister(fullName: string): void {
    this.tools.delete(fullName)
  }

  /** 按工具启停（MCP/Skill 按工具粒度管控） */
  setEnabled(fullName: string, enabled: boolean): void {
    const reg = this.tools.get(fullName)
    if (reg) reg.enabled = enabled
  }

  has(fullName: string): boolean {
    return this.tools.has(fullName)
  }

  /** 按权限模式过滤后的工具列表（会话期冻结后复用） */
  listForMode(mode: PermissionMode): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const reg of this.tools.values()) {
      if (!reg.enabled) continue
      if (!isAllowedByMode(reg.def, mode)) continue
      result.push(reg.def)
    }
    // 按名称排序保证确定性序列化（§3.6 规则 2）
    result.sort((a, b) => a.fullName.localeCompare(b.fullName))
    return result
  }

  /** 全部启用工具（与模式无关） */
  listAll(): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const reg of this.tools.values()) {
      if (reg.enabled) result.push(reg.def)
    }
    result.sort((a, b) => a.fullName.localeCompare(b.fullName))
    return result
  }

  /** 执行一个工具调用 */
  async execute(fullName: string, input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
    const reg = this.tools.get(fullName)
    if (!reg || !reg.enabled) {
      throw new Error(`未注册或已禁用的工具: ${fullName}`)
    }
    const parsed = reg.def.inputSchema.safeParse(input)
    if (!parsed.success) {
      throw new Error(`工具 ${fullName} 参数校验失败: ${parsed.error.message}`)
    }
    return reg.executor(parsed.data, ctx)
  }
}

/**
 * 三级权限模式对工具种类的过滤矩阵（§需求22 三级权限精确定义）。
 * 读操作计划模式放行；写/编辑/命令按模式收窄。
 */
export function isAllowedByMode(def: ToolDefinition, mode: PermissionMode): boolean {
  if (mode === 'fullAccess') return true

  if (mode === 'plan') {
    // 计划：只读 + 创建文件夹 + 计划文档（Write/Edit 命中 PlanDocPattern 时放行，见 PermissionService）
    switch (def.kind) {
      case 'read':
      case 'search':
        return true
      case 'write':
      case 'edit':
        // 计划文档是否放行由运行时判定（依赖输入路径），此处保留定义参与工具列表
        return def.name === 'Write' || def.name === 'Edit'
      case 'shell':
      case 'browser':
      case 'sandbox':
      case 'task':
      case 'memory':
      case 'kb':
      case 'mcp':
      case 'skill':
        return false
      default:
        return true
    }
  }

  // acceptEdits：只读 + 文件写/编辑放行；shell 需确认；其余计划阶段允许的放行
  switch (def.kind) {
    case 'read':
    case 'search':
    case 'write':
    case 'edit':
    case 'plan':
      return true
    case 'shell':
    case 'browser':
    case 'sandbox':
    case 'mcp':
    case 'skill':
    case 'memory':
    case 'kb':
      return def.readOnly === true
    default:
      return true
  }
}

/** 空会话辅助签名（占位，供类型工具引用） */
export type ToolSessionInfo = { sessionId: SessionId; toolCallId: ToolCallId }
