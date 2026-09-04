import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PermissionMode } from '@core/events'
import type { ThinkingLevel } from '@core/models'
import type { ToolDefinition } from '@core/tools/types'
import { canonicalJson } from '../provider/canonical'

const BASE_TEMPLATES = ['identity.md', 'main-loop.md', 'tools.md', 'security.md', 'skills-guide.md', 'memory-guide.md']

export interface PromptEnvironment {
  workspacePath: string
  os: string
  shell: string
  model: string
  thinkingLevel: ThinkingLevel
  mode: PermissionMode
  tools: ToolDefinition[]
  skillsIndex?: string
  memorySection?: string
  projectRules?: string
  today?: string
}

export interface AssembledPrompt {
  systemPrompt: string
  toolsSection: string
  skillsIndex: string
}

/** 模块化系统提示组装器。实例会冻结环境值，确保会话期前缀稳定。 */
export class PromptAssembler {
  private frozen: AssembledPrompt | null = null

  constructor(
    private readonly environment: PromptEnvironment,
    private readonly templateRoot = findPromptRoot()
  ) {}

  async assemble(): Promise<AssembledPrompt> {
    if (this.frozen) return this.frozen
    const names = [...BASE_TEMPLATES]
    if (this.environment.mode === 'plan') names.splice(3, 0, 'plan-mode.md')
    const sections = await Promise.all(names.map((name) => readFile(join(this.templateRoot, name), 'utf8')))
    const toolsSection = canonicalJson(
      this.environment.tools.map((tool) => ({
        description: tool.description,
        name: tool.fullName,
        parameters: tool.inputJsonSchema
      }))
    )
    const skillsIndex = this.environment.skillsIndex?.trim() || '当前未挂载技能。'
    const memorySection = this.environment.memorySection?.trim() || '当前没有已加载的长期记忆。'
    const projectRules = this.environment.projectRules?.trim() || '当前工作区没有 AGENTS.md 项目规则。'
    const values: Record<string, string> = {
      workspacePath: this.environment.workspacePath,
      os: this.environment.os,
      shell: this.environment.shell,
      model: this.environment.model,
      thinkingLevel: this.environment.thinkingLevel,
      today: this.environment.today ?? new Date().toISOString().slice(0, 10),
      toolsSection,
      skillsIndex,
      memorySection
    }
    const body = sections.map((section) => interpolate(section, values)).join('\n\n---\n\n')
    this.frozen = {
      systemPrompt: `${body}\n\n---\n\n## 工作区项目规则\n\n${projectRules}\n\n## 已加载记忆\n\n${memorySection}`,
      toolsSection,
      skillsIndex
    }
    return this.frozen
  }
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_match, key: string) => values[key] ?? '')
}

function findPromptRoot(): string {
  const candidates = [
    resolve(process.cwd(), 'docs', 'prompts'),
    resolve(process.resourcesPath ?? '', 'docs', 'prompts'),
    resolve(__dirname, '..', '..', '..', 'docs', 'prompts')
  ]
  const found = candidates.find((candidate) => existsSync(join(candidate, 'identity.md')))
  if (!found) throw new Error('找不到 docs/prompts 系统提示模板')
  return found
}
