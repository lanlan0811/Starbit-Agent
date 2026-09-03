import type { PermissionMode } from '../events'
import type { ToolDefinition } from '../tools/types'
import { matchDangerousRule, type DangerousRule } from './dangerous-rules'
import {
  globToRegExp,
  toRuleSubject,
  type PermissionRule,
  type RuleAction,
  type RuleScope
} from './rules'

/**
 * PermissionService —— 三级权限 + 规则匹配 + 白名单 + 危险命令判定。
 * 权限判定流程：白名单匹配 → 模式矩阵判定 → 弹窗询问（由调用方驱动）。
 */

export type Decision = {
  verdict: 'allow' | 'deny' | 'ask'
  reason: 'whitelist' | 'mode' | 'dangerous' | 'fallback'
  matchedRule?: PermissionRule
  dangerousRule?: DangerousRule
}

export interface PermissionRequest {
  tool: ToolDefinition
  /** 语义标签（Write / Bash / Edit / ...） */
  semanticLabel: string
  /** 文件路径或命令等主要 subject 片段 */
  subject: string
  mode: PermissionMode
  /** 完整命令（用于危险判定，shell 时提供解析后实际命令） */
  rawCommand?: string
}

export class PermissionService {
  private mode: PermissionMode = 'fullAccess'
  private rules: PermissionRule[] = []
  /** 本会话已批准的一次性/会话级记录 */
  private sessionApprovals = new Set<string>()
  private dangerousRules: DangerousRule[] = []

  constructor(dangerousRules: DangerousRule[] = []) {
    this.dangerousRules = dangerousRules
  }

  setMode(mode: PermissionMode): PermissionMode {
    const prev = this.mode
    this.mode = mode
    return prev
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setRules(rules: PermissionRule[]): void {
    this.rules = rules
  }

  setDangerousRules(rules: DangerousRule[]): void {
    this.dangerousRules = rules
  }

  /** 计划文档判定（§PlanDocPattern）—— 命中 `***.md` 约定放行 */
  isPlanDoc(path: string, pattern: RegExp = /[\\/][^\\/]*?(计划|plan)[^\\/]*\.md$/i): boolean {
    return pattern.test(path)
  }

  /**
   * 核心判定。
   * 返回 verdict；当 verdict=ask 时调用方需展示确认弹窗并把用户选择经 recordDecision 落地。
   */
  decide(req: PermissionRequest): Decision {
    const subject = toRuleSubject(req.semanticLabel, req.subject)

    // 1. 危险命令判定（优先且不可被规则覆盖的 block）
    if (req.rawCommand || req.tool.kind === 'shell' || req.tool.semanticLabel === 'Bash') {
      const cmd = req.rawCommand ?? req.subject
      const dangerous = matchDangerousRule(cmd, this.dangerousRules)
      if (dangerous) {
        if (dangerous.severity === 'block') {
          return { verdict: 'deny', reason: 'dangerous', dangerousRule: dangerous }
        }
        // severity=warn：block 规则由模式矩阵决定，但标记需确认
        return { verdict: 'ask', reason: 'dangerous', dangerousRule: dangerous }
      }
    }

    // 2. 白名单规则匹配
    const rule = this.findMatchingRule(subject)
    if (rule) {
      this.bumpHit(rule)
      if (rule.action === 'allow') return { verdict: 'allow', reason: 'whitelist', matchedRule: rule }
      if (rule.action === 'deny') return { verdict: 'deny', reason: 'whitelist', matchedRule: rule }
      // ask 规则落到模式判定
    }

    // 3. 模式矩阵判定
    return this.decideByMode(req, subject)
  }

  private decideByMode(req: PermissionRequest, subject: string): Decision {
    const { mode, tool } = req

    // 只读操作：三模式均放行
    if (tool.readOnly) return { verdict: 'allow', reason: 'mode' }

    // 计划文档：计划模式下放行创建与编辑
    if (mode === 'plan') {
      const isDoc = tool.kind === 'write' || tool.kind === 'edit'
      if (isDoc) {
        if (this.isPlanDoc(req.subject)) return { verdict: 'allow', reason: 'mode' }
        return { verdict: 'deny', reason: 'mode' }
      }
      // 计划模式的只读操作（read/search/创建文件夹）放行
      if (tool.kind === 'read' || tool.kind === 'search') return { verdict: 'allow', reason: 'mode' }
      return { verdict: 'deny', reason: 'mode' }
    }

    if (mode === 'acceptEdits') {
      if (tool.kind === 'write' || tool.kind === 'edit') return { verdict: 'allow', reason: 'mode' }
      if (tool.kind === 'shell' || tool.dangerLevel === 1) return { verdict: 'ask', reason: 'fallback' }
      if (tool.kind === 'read' || tool.kind === 'search') return { verdict: 'allow', reason: 'mode' }
      return { verdict: 'ask', reason: 'fallback' }
    }

    // fullAccess
    if (tool.dangerLevel === 2 || tool.kind === 'shell') return { verdict: 'ask', reason: 'fallback' }
    return { verdict: 'allow', reason: 'mode' }
  }

  /** 记录用户对 ask 的决策，把永久/会话级落地为白名单规则 */
  recordDecision(req: PermissionRequest, outcome: 'allow' | 'deny', scope: RuleScope): void {
    if (scope === 'permanent' && outcome === 'allow') {
      this.rules.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        semanticLabel: req.semanticLabel,
        pattern: req.subject,
        action: 'allow',
        scope: 'permanent',
        createdAt: Date.now()
      })
    } else if (scope === 'session' && outcome === 'allow') {
      this.sessionApprovals.add(toRuleSubject(req.semanticLabel, req.subject))
    }
  }

  /** 是否命中本会话已批准的记录 */
  isSessionApproved(semanticLabel: string, subject: string): boolean {
    return this.sessionApprovals.has(toRuleSubject(semanticLabel, subject))
  }

  private findMatchingRule(subject: string): PermissionRule | undefined {
    // 永久规则优先，其次按添加顺序
    for (const rule of this.rules) {
      if (ruleMatchesBySubject(rule, subject)) return rule
    }
    return undefined
  }

  private bumpHit(rule: PermissionRule): void {
    rule.hitCount = (rule.hitCount ?? 0) + 1
  }

  getRules(): PermissionRule[] {
    return [...this.rules]
  }

  /** 持久化导出 */
  serialize(): { rules: PermissionRule[]; dangerousRules: DangerousRule[] } {
    return { rules: this.rules, dangerousRules: this.dangerousRules }
  }
}

function ruleMatchesBySubject(rule: PermissionRule, subject: string): boolean {
  // 形式：Write(Bash(...)) 或 Write(路径) / 精确语义标签
  if (rule.semanticLabel === rule.pattern) {
    return subject === rule.semanticLabel
  }
  if (subject.startsWith(`${rule.semanticLabel}(`)) {
    const inner = subject.slice(rule.semanticLabel.length + 1, subject.length - 1)
    return globToRegExp(rule.pattern).test(inner)
  }
  return subject === rule.semanticLabel
}

export type { PermissionRule, RuleAction, RuleScope }
