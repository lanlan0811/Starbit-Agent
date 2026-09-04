import { describe, expect, it } from 'vitest'
import { parseDangerousRules } from './dangerous-rules'

describe('custom dangerous rules', () => {
  it('解析并验证 version 1 YAML', () => {
    expect(parseDangerousRules('version: 1\nrules:\n  - id: hidden\n    pattern: "encoded"\n    description: 隐藏命令\n    severity: warn\n')).toEqual([
      { id: 'hidden', pattern: 'encoded', description: '隐藏命令', severity: 'warn', custom: true }
    ])
  })

  it('拒绝无效正则与威胁等级', () => {
    expect(() => parseDangerousRules('version: 1\nrules:\n  - id: bad\n    pattern: "["\n    description: bad\n    severity: allow\n')).toThrow()
  })
})
