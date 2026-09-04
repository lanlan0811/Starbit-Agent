import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolRegistry } from '@core/tools/registry'
import { SkillManager, parseSkillMarkdown } from './manager'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('SkillManager', () => {
  it('解析 Claude Skills frontmatter', () => {
    const skill = parseSkillMarkdown('---\nname: demo\ndescription: 示例技能\n---\n正文', 'C:\\skills\\demo\\SKILL.md', 'user')
    expect(skill.name).toBe('demo')
    expect(skill.description).toBe('示例技能')
  })

  it('扫描技能、生成索引并注册渐进加载工具', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starbit-skills-'))
    roots.push(root)
    const skillRoot = join(root, 'demo')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: demo\ndescription: 示例技能\n---\n# 正文', 'utf8')
    const manager = new SkillManager({ workspacePath: root, userRoots: [root], workspaceRoots: [] })
    await manager.scan()
    expect(manager.index()).toContain('demo: 示例技能')
    expect(await manager.directContext('/demo 执行')).toContain('# 正文')
    const registry = new ToolRegistry()
    manager.registerTools(registry)
    const result = await registry.execute('LoadSkill', { name: 'demo' }, { workspacePath: root, sessionId: 's', toolCallId: 't', mode: 'plan' })
    expect(result.content).toContain('# 正文')
  })
})
