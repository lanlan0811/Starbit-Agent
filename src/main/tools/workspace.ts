import { isAbsolute, relative, resolve } from 'node:path'

/** 将工具输入解析为绝对路径，并确保目标位于工作区或用户显式授权的根目录内。 */
export function resolveAuthorizedPath(workspacePath: string, inputPath: string, grantedRoots: string[] = []): string {
  const workspace = resolve(workspacePath)
  const target = resolve(isAbsolute(inputPath) ? inputPath : resolve(workspace, inputPath))
  const roots = [workspace, ...grantedRoots.map((root) => resolve(root))]
  if (!roots.some((root) => isPathInside(root, target))) {
    throw new Error(`路径超出已授权范围: ${target}`)
  }
  return target
}

export function isPathInside(root: string, target: string): boolean {
  const result = relative(root, target)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}
