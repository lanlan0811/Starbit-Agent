import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { resolveAuthorizedPath } from '../tools/workspace'

/** 文件树单条目录项（相对工作区路径）。 */
export interface WorkspaceEntryDto {
  path: string
  name: string
  isDir: boolean
  size: number
  modifiedAt: number
}

/** 工作区文件列表选项与上限（防止超大仓库拖垮 IPC）。 */
export interface ListWorkspaceOptions {
  maxEntries?: number
  maxDepth?: number
}

export const DEFAULT_LIST_OPTIONS: Required<ListWorkspaceOptions> = {
  maxEntries: 4000,
  maxDepth: 12
}

/** 默认忽略目录：依赖、构建产物与本地数据库等大体积目录不进入文件树。 */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'out',
  'dist',
  'dist-electron',
  'release',
  'build',
  'test-results',
  'playwright-report',
  '.starbit',
  '.claude',
  '.zcode',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode'
])

/** 读取工作区文件树（受忽略规则与数量/深度上限约束），路径均经工作区沙盒校验。 */
export async function listWorkspaceFiles(workspacePath: string, options: ListWorkspaceOptions = {}): Promise<WorkspaceEntryDto[]> {
  const limits = { ...DEFAULT_LIST_OPTIONS, ...options }
  const root = resolveAuthorizedPath(workspacePath, '.')
  const entries: WorkspaceEntryDto[] = []

  async function walk(absolute: string, depth: number): Promise<boolean> {
    if (entries.length >= limits.maxEntries) return false
    if (depth > limits.maxDepth) return true
    let dirents
    try {
      dirents = await fs.readdir(absolute, { withFileTypes: true })
    } catch {
      return true
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    for (const dirent of dirents) {
      if (entries.length >= limits.maxEntries) return false
      if (dirent.name.startsWith('.') && IGNORED_DIRECTORIES.has(dirent.name)) continue
      if (IGNORED_DIRECTORIES.has(dirent.name)) continue
      const childAbsolute = join(absolute, dirent.name)
      // 逐级校验，目录联接/符号链接越界时跳过而不是中断整棵树
      let relativePath: string
      try {
        relativePath = relative(root, resolveAuthorizedPath(root, childAbsolute))
      } catch {
        continue
      }
      if (relativePath.startsWith('..')) continue
      if (dirent.isDirectory()) {
        entries.push({ path: toPosix(relativePath), name: dirent.name, isDir: true, size: 0, modifiedAt: 0 })
        const descend = await walk(childAbsolute, depth + 1)
        if (!descend) return false
      } else if (dirent.isFile()) {
        const stat = await fs.stat(childAbsolute).catch(() => null)
        entries.push({
          path: toPosix(relativePath),
          name: dirent.name,
          isDir: false,
          size: stat?.size ?? 0,
          modifiedAt: stat?.mtimeMs ?? 0
        })
      }
    }
    return true
  }

  await walk(root, 1)
  return entries
}

/** 读取工作区内文本文件用于预览（字节与行数双重截断，二进制内容拒绝返回）。 */
export async function readWorkspaceFilePreview(workspacePath: string, inputPath: string, maxBytes = 96 * 1024): Promise<{ path: string; content: string; truncated: boolean }> {
  const absolute = resolveAuthorizedPath(workspacePath, inputPath)
  const stat = await fs.stat(absolute)
  if (!stat.isFile()) throw new Error(`目标不是文件: ${inputPath}`)
  const buffer = await fs.readFile(absolute)
  const truncated = buffer.byteLength > maxBytes
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer
  if (slice.includes(0)) throw new Error('二进制文件不支持预览')
  return { path: toPosix(relative(resolveAuthorizedPath(workspacePath, '.'), absolute)), content: slice.toString('utf-8'), truncated }
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}
