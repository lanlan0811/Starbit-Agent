import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'

/** 将工具输入解析为绝对路径，并确保目标位于工作区或用户显式授权的根目录内。 */
export function resolveAuthorizedPath(workspacePath: string, inputPath: string, grantedRoots: string[] = []): string {
  const workspace = resolve(workspacePath)
  const target = resolve(isAbsolute(inputPath) ? inputPath : resolve(workspace, inputPath))
  const roots = [workspace, ...grantedRoots.map((root) => resolve(root))]
  if (!roots.some((root) => isPathInside(root, target))) {
    throw new Error(`路径超出已授权范围: ${target}`)
  }
  const physicalTarget = physicalPath(target)
  if (!roots.some((root) => isPathInside(physicalPath(root), physicalTarget))) {
    throw new Error(`符号链接或目录联接指向授权范围外: ${target}`)
  }
  return target
}

export function isPathInside(root: string, target: string): boolean {
  const result = relative(root, target)
  return result === '' || (result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result))
}

/** 新建文件也校验最近已存在父目录的真实位置。 */
function physicalPath(path: string): string {
  try { return realpathSync.native(path) } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(physicalPath(parent), relative(parent, path))
  }
}
