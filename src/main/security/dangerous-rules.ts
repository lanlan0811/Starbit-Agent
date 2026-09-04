import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import type { DangerousRule } from '@core/permission/dangerous-rules'

interface DangerousRuleDocument {
  version?: unknown
  rules?: unknown
}

/** 加载资源规则与用户覆盖文件；同 ID 的后加载规则覆盖前者。 */
export async function loadDangerousRules(paths: string[]): Promise<DangerousRule[]> {
  const merged = new Map<string, DangerousRule>()
  for (const path of new Set(paths.map((path) => resolve(path)))) {
    if (!existsSync(path)) continue
    const content = await readFile(path, 'utf8')
    for (const rule of parseDangerousRules(content, path)) merged.set(rule.id, rule)
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function parseDangerousRules(content: string, source = 'dangerous-rules.yaml'): DangerousRule[] {
  let value: DangerousRuleDocument
  try {
    value = parse(content) as DangerousRuleDocument
  } catch (error) {
    throw new Error(`${source} YAML 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || value.version !== 1) throw new Error(`${source} 仅支持 version: 1`)
  if (!Array.isArray(value.rules)) throw new Error(`${source} 缺少 rules 数组`)
  if (value.rules.length > 500) throw new Error(`${source} 规则数量超过 500`)
  return value.rules.map((item, index) => validateRule(item, `${source} rules[${index}]`))
}

function validateRule(value: unknown, location: string): DangerousRule {
  if (!value || typeof value !== 'object') throw new Error(`${location} 必须是对象`)
  const record = value as Record<string, unknown>
  const id = String(record.id ?? '').trim()
  const pattern = String(record.pattern ?? '')
  const description = String(record.description ?? '').trim()
  const severity = record.severity
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error(`${location}.id 无效`)
  if (!pattern || pattern.length > 8_192) throw new Error(`${location}.pattern 无效`)
  try { new RegExp(pattern, 'i') } catch (error) { throw new Error(`${location}.pattern 不是有效正则：${error instanceof Error ? error.message : String(error)}`) }
  if (!description || description.length > 1_000) throw new Error(`${location}.description 无效`)
  if (severity !== 'warn' && severity !== 'block') throw new Error(`${location}.severity 必须是 warn 或 block`)
  return { id, pattern, description, severity, custom: true }
}
