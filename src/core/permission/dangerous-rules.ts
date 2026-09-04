import type { PermissionMode } from '../events'

/**
 * 危险命令规则库 —— 内置规则 + 自定义（resources/dangerous-rules.yaml）
 */

export interface DangerousRule {
  id: string
  /** 匹配的正则（对完整命令） */
  pattern: string
  /** 规则语义描述 */
  description: string
  /** 命中后的威胁级别：warn（建议确认）/ block（强制拒绝） */
  severity: 'warn' | 'block'
  /** 是否用户自定义 */
  custom?: boolean
}

/**
 * 内置危险指令规则（Windows 优先，覆盖 rm -rf、格式化、curl|sh、注册表、提权等）。
 * 用户可在 resources/dangerous-rules.yaml 增补。
 */
export const BUILTIN_DANGEROUS_RULES: DangerousRule[] = [
  { id: 'rm-force-recursive', pattern: '\\brm\\s+(-[a-z]*f[a-z\\s-]*r|-r[a-z\\s-]*f)', description: '强制递归删除（rm -rf）', severity: 'block' },
  { id: 'del-recursive', pattern: '\\b(rmdir|del)\\s+/[s]/[q]|\\bRemove-Item\\s+[^\\r\\n]*-Recurse', description: 'Windows 递归删除命令', severity: 'block' },
  { id: 'format-disk', pattern: '\\bformat(?:\\.com)?\\s+[a-z]:', description: '磁盘格式化', severity: 'block' },
  { id: 'pipe-curl-sh', pattern: '\\bcurl\\b.*\\|\\s*(ba)?sh\\b', description: 'curl 管道到 shell 执行', severity: 'warn' },
  { id: 'pipe-wget-sh', pattern: '\\bwget\\b.*\\|\\s*(ba)?sh\\b', description: 'wget 管道到 shell 执行', severity: 'warn' },
  { id: 'registry-edit', pattern: '\\breg\\s+(add|delete)\\b|\\bSet-ItemProperty\\b.*\\bHKLM', description: '注册表修改', severity: 'warn' },
  { id: 'privilege-escalation', pattern: '\\b(runas\\s+/user:administrator|sudo\\b|Start-Process\\s+-Verb\\s+RunAs)', description: '提权操作', severity: 'block' },
  { id: 'wipe-root', pattern: '^\\s*(rm\\s+-rf\\s+/|rmdir\\s+/s\\s+[a-z]:\\\\|Remove-Item\\s+-Recurse\\s+[A-Z]:\\\\)', description: '清空根目录/整盘', severity: 'block' },
  { id: 'diskpart-clean', pattern: '\\bdiskpart\\b.*\\bclean\\b|\\bclean\\s+all\\b', description: '磁盘分区清理', severity: 'block' }
]

/** 规则引擎：对命令匹配危险规则 */
export function matchDangerousRule(
  command: string,
  rules: DangerousRule[] = BUILTIN_DANGEROUS_RULES
): DangerousRule | undefined {
  for (const rule of [...rules].sort((a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'))) {
    try {
      const re = new RegExp(rule.pattern, 'i')
      if (re.test(command)) return rule
    } catch {
      // 忽略无效正则
    }
  }
  return undefined
}

export type { PermissionMode }
