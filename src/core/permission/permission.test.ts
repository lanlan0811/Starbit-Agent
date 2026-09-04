import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '../tools/types'
import { PermissionService } from './index'
import { BUILTIN_DANGEROUS_RULES } from './dangerous-rules'

function tool(kind: ToolDefinition['kind'], semanticLabel: string, readOnly = false): ToolDefinition {
  return {
    name: semanticLabel,
    fullName: semanticLabel,
    description: '',
    inputSchema: z.object({}),
    inputJsonSchema: { type: 'object' },
    kind,
    semanticLabel,
    source: 'builtin',
    readOnly
  }
}

describe('PermissionService', () => {
  it('计划模式仅放行读取、目录和计划文档', () => {
    const service = new PermissionService(BUILTIN_DANGEROUS_RULES)
    expect(service.decide({ tool: tool('read', 'Read', true), semanticLabel: 'Read', subject: 'README.md', mode: 'plan' }).verdict).toBe('allow')
    expect(service.decide({ tool: tool('write', 'Mkdir'), semanticLabel: 'Mkdir', subject: 'docs', mode: 'plan', createsDirectory: true }).verdict).toBe('allow')
    expect(service.decide({ tool: tool('write', 'Write'), semanticLabel: 'Write', subject: 'docs/实施计划.md', mode: 'plan' }).verdict).toBe('allow')
    expect(service.decide({ tool: tool('write', 'Write'), semanticLabel: 'Write', subject: 'src/index.ts', mode: 'plan' }).verdict).toBe('deny')
  })

  it('完全访问模式自动放行普通 Shell，但危险指令强制拒绝', () => {
    const service = new PermissionService(BUILTIN_DANGEROUS_RULES)
    const bash = tool('shell', 'Bash')
    expect(service.decide({ tool: bash, semanticLabel: 'Bash', subject: 'pnpm test', rawCommand: 'pnpm test', mode: 'fullAccess' }).verdict).toBe('allow')
    expect(service.decide({ tool: bash, semanticLabel: 'Bash', subject: 'Remove-Item -Recurse C:\\', rawCommand: 'Remove-Item -Recurse C:\\', mode: 'fullAccess' }).verdict).toBe('deny')
  })

  it('本会话批准后复用相同授权', () => {
    const service = new PermissionService()
    const bash = tool('shell', 'Bash')
    const request = { tool: bash, semanticLabel: 'Bash', subject: 'pnpm test', mode: 'acceptEdits' as const }
    expect(service.decide(request).verdict).toBe('ask')
    service.recordDecision(request, 'allow', 'session')
    expect(service.decide(request).verdict).toBe('allow')
  })
})
