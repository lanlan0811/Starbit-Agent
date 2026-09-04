import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolResult } from '@core/tools/types'
import { ToolRegistry } from '@core/tools/registry'

export interface SkillManifest {
  name: string
  description: string
  root: string
  markdownPath: string
  scripts: string[]
  scope: 'user' | 'workspace'
}

export interface SkillManagerOptions {
  workspacePath: string
  userRoots?: string[]
  workspaceRoots?: string[]
  interpreters?: Partial<Record<string, { executable: string; args: string[] }>>
}

const SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export class SkillManager {
  private manifests: SkillManifest[] = []

  constructor(private readonly options: SkillManagerOptions) {}

  async scan(): Promise<SkillManifest[]> {
    const userRoots = this.options.userRoots ?? [join(homedir(), '.starbit', 'skills'), join(homedir(), '.claude', 'skills')]
    const workspaceRoots = this.options.workspaceRoots ?? [
      join(this.options.workspacePath, '.starbit', 'skills'),
      join(this.options.workspacePath, '.claude', 'skills')
    ]
    const discovered = [
      ...(await scanRoots(userRoots, 'user')),
      ...(await scanRoots(workspaceRoots, 'workspace'))
    ]
    const byName = new Map<string, SkillManifest>()
    for (const manifest of discovered) byName.set(manifest.name.toLowerCase(), manifest)
    this.manifests = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    return this.list()
  }

  list(): SkillManifest[] {
    return this.manifests.map((manifest) => ({ ...manifest, scripts: [...manifest.scripts] }))
  }

  index(): string {
    if (this.manifests.length === 0) return '当前未挂载技能。'
    return this.manifests.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')
  }

  async load(name: string): Promise<string> {
    const skill = this.manifests.find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (!skill) throw new Error(`找不到技能: ${name}`)
    return readFile(skill.markdownPath, 'utf8')
  }

  /** 斜杠命令直接触发技能正文；普通文本仅注入索引，由模型按需调用 LoadSkill。 */
  async directContext(message: string): Promise<string> {
    const match = message.trim().match(/^\/([a-zA-Z0-9][a-zA-Z0-9._-]*)\b/)
    return match ? this.load(match[1]) : ''
  }

  registerTools(registry: ToolRegistry): void {
    registry.register(loadSkillDefinition(), async (input) => ({ content: await this.load(String((input as { name: string }).name)) }))
    for (const skill of this.manifests) {
      for (const script of skill.scripts) {
        const fullName = `skill__${safeName(skill.name)}__${safeName(basename(script, extname(script)))}`
        registry.register(scriptDefinition(fullName, skill, script), async (input, context) =>
          runSkillScript(script, (input as { args?: string[] }).args ?? [], context, this.options.interpreters)
        )
      }
    }
  }
}

export function parseSkillMarkdown(markdown: string, markdownPath: string, scope: SkillManifest['scope']): SkillManifest {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) throw new Error(`${markdownPath} 缺少 YAML frontmatter`)
  const frontmatter = parseSimpleYaml(match[1])
  const name = frontmatter.name?.trim() ?? ''
  const description = frontmatter.description?.trim() ?? ''
  if (!SKILL_NAME.test(name)) throw new Error(`${markdownPath} 的技能名称无效`)
  if (!description) throw new Error(`${markdownPath} 缺少 description`)
  return { name, description, root: resolve(markdownPath, '..'), markdownPath, scripts: [], scope }
}

async function scanRoots(roots: string[], scope: SkillManifest['scope']): Promise<SkillManifest[]> {
  const result: SkillManifest[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const markdownPath = join(root, entry.name, 'SKILL.md')
      try {
        const manifest = parseSkillMarkdown(await readFile(markdownPath, 'utf8'), markdownPath, scope)
        manifest.scripts = await findScripts(join(manifest.root, 'scripts'))
        result.push(manifest)
      } catch {
        // 单个损坏技能不会阻断其他技能加载；设置页会展示扫描诊断。
      }
    }
  }
  return result
}

async function findScripts(root: string): Promise<string[]> {
  const result: string[] = []
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) queue.push(path)
      else if (entry.isFile()) result.push(path)
    }
  }
  return result.sort()
}

function parseSimpleYaml(value: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (!match) continue
    output[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return output
}

function loadSkillDefinition(): ToolDefinition {
  return {
    name: 'LoadSkill',
    fullName: 'LoadSkill',
    description: '按名称加载一个已挂载技能的完整 SKILL.md 指令。',
    inputSchema: z.object({ name: z.string().min(1) }),
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } }, required: ['name'] },
    kind: 'skill',
    readOnly: true,
    dangerLevel: 0,
    semanticLabel: 'Read',
    source: 'builtin'
  }
}

function scriptDefinition(fullName: string, skill: SkillManifest, script: string): ToolDefinition {
  return {
    name: basename(script),
    fullName,
    description: `运行技能 ${skill.name} 的脚本 ${basename(script)}。`,
    inputSchema: z.object({ args: z.array(z.string()).max(64).optional() }),
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { args: { type: 'array', items: { type: 'string' }, maxItems: 64 } } },
    kind: 'skill',
    readOnly: false,
    dangerLevel: 1,
    semanticLabel: 'Skill',
    source: `skill:${skill.name}`
  }
}

async function runSkillScript(
  script: string,
  args: string[],
  context: ToolContext,
  configured: SkillManagerOptions['interpreters'] = {}
): Promise<ToolResult> {
  await stat(script)
  const extension = extname(script).toLowerCase()
  const defaults: Record<string, { executable: string; args: string[] }> = {
    '.js': { executable: process.execPath, args: [] },
    '.mjs': { executable: process.execPath, args: [] },
    '.py': { executable: process.env.STARBIT_PYTHON || 'python', args: [] },
    '.ps1': { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File'] },
    '.cmd': { executable: 'cmd.exe', args: ['/d', '/s', '/c'] },
    '.bat': { executable: 'cmd.exe', args: ['/d', '/s', '/c'] }
  }
  const runner = configured?.[extension] ?? defaults[extension] ?? { executable: script, args: [] }
  const spawnArgs = runner.executable === script ? args : [...runner.args, script, ...args]
  return capture(runner.executable, spawnArgs, context)
}

function capture(executable: string, args: string[], context: ToolContext): Promise<ToolResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: context.workspacePath, env: { ...process.env, ...context.env }, windowsHide: true })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    const abort = (): void => { child.kill() }
    context.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (code) => {
      context.signal?.removeEventListener('abort', abort)
      const content = Buffer.concat(output).toString('utf8')
      if (code !== 0) reject(new Error(`技能脚本退出码 ${code}\n${content}`))
      else resolvePromise({ content: content || '技能脚本执行成功，无输出。' })
    })
  })
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}
