import type { PermissionMode } from './events'

/** 主进程与渲染进程共享的会话元数据契约。 */
export interface SessionMeta {
  id: string
  title: string
  workspacePath: string
  mode: PermissionMode
  model: string
  createdAt: number
  updatedAt: number
}
