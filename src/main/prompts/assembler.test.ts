import { describe, expect, it } from 'vitest'
import { getModel } from '@core/models'
import { createBuiltinToolRegistry } from '../tools/builtin'
import { PromptAssembler } from './assembler'

describe('PromptAssembler', () => {
  it('冻结会话环境并插入工具、规则和记忆', async () => {
    const registry = createBuiltinToolRegistry({ shell: { executable: process.execPath, args: ['-e'] } })
    const assembler = new PromptAssembler({
      workspacePath: 'D:\\workspace',
      os: 'Windows 10',
      shell: 'PowerShell',
      model: getModel('qwen3.8-max')!.id,
      thinkingLevel: 'max',
      mode: 'fullAccess',
      tools: registry.listForMode('fullAccess'),
      projectRules: '必须测试',
      memorySection: '偏好中文',
      today: '2026-09-04'
    })
    const first = await assembler.assemble()
    const second = await assembler.assemble()
    expect(first).toBe(second)
    expect(first.systemPrompt).toContain('2026-09-04')
    expect(first.systemPrompt).toContain('必须测试')
    expect(first.toolsSection).toContain('Bash')
  })
})
