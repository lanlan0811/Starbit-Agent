import { createHash } from 'node:crypto'
import type { JsonValue } from '@core/types'
import type { PrefixComparison, PrefixSections } from './types'

/** 递归排序对象键，数组顺序保持不变，确保请求前缀可重复序列化。 */
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key])
    return sorted
  }
  return value
}

export function sha256(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/**
 * 会话级前缀自检。首次调用建立基线，后续调用只报告变化，不自动覆盖基线，
 * 便于诊断首次击穿缓存的真实来源。
 */
export class PrefixFingerprintTracker {
  private baseline: Record<keyof PrefixSections, string> | null = null

  compare(sections: PrefixSections): PrefixComparison {
    const hashes = hashSections(sections)
    const fingerprint = sha256(hashes)
    if (!this.baseline) {
      this.baseline = hashes
      return { fingerprint, changed: false, changedSections: [] }
    }

    const changedSections = (Object.keys(hashes) as Array<keyof PrefixSections>).filter(
      (key) => hashes[key] !== this.baseline?.[key]
    )
    return { fingerprint, changed: changedSections.length > 0, changedSections }
  }
}

function hashSections(sections: PrefixSections): Record<keyof PrefixSections, string> {
  return {
    system: sha256(sections.system),
    tools: sha256(sections.tools),
    skills: sha256(sections.skills)
  }
}
