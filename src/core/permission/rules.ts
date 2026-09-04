/**
 * 白名单规则 —— 形如 `Bash(npm run *)`、`Write(./docs/**)` 的 allow/deny/ask 三元组。
 * 持久化存储，范畴：本次 / 本会话 / 永久。
 */

export type RuleAction = 'allow' | 'deny' | 'ask'
export type RuleScope = 'once' | 'session' | 'permanent'

export interface PermissionRule {
  id: string
  /** 语义标签（Write / Bash / Edit / 或具体工具全名） */
  semanticLabel: string
  /** 通配符匹配串，如 npm run * 或 ./docs/** */
  pattern: string
  action: RuleAction
  scope: RuleScope
  /** 创建时间 */
  createdAt: number
  /** 命中计数 */
  hitCount?: number
}

/** 将语义标签 + 输入转成可匹配的规则串 */
export function toRuleSubject(semanticLabel: string, inputPath: string | undefined): string {
  if (inputPath) return `${semanticLabel}(${inputPath})`
  return semanticLabel
}

/** 通配符（* 与 **）转正则 */
export function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** 判断是否命中某条规则 */
export function ruleMatches(rule: PermissionRule, subject: string): boolean {
  // 先匹配语义标签，再匹配 pattern 子串（pattern 可能只针对路径部分）
  if (!subject.startsWith(rule.semanticLabel)) return false
  const rest = subject.slice(rule.semanticLabel.length).replace(/^\(/, '').replace(/\)$/, '')
  const target = rule.pattern.includes('(') ? rule.pattern : rule.pattern
  if (!rest && !target) return true
  return globToRegExp(target).test(rest)
}

/** 规范化模型：白名单持久化存储格式 */
export interface WhitelistStore {
  rules: PermissionRule[]
}
