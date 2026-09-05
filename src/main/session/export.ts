import { nanoid } from '@core/nanoid'
import type { PermissionMode, SessionEvent } from '@core/events'
import type { SessionMeta } from '@core/session'
import { SessionManager } from './manager'

/**
 * 会话导出/导入 —— Markdown 转写稿与 JSON 事件流两种形态。
 * JSON 归档带 kind/version 标记；导入时重映射会话与事件 ID，可重复导入。
 */

export const SESSION_ARCHIVE_KIND = 'starbit-session'
export const SESSION_ARCHIVE_VERSION = 1

export interface SessionArchive {
  kind: typeof SESSION_ARCHIVE_KIND
  version: number
  exportedAt: number
  session: { title: string; workspacePath: string; mode: PermissionMode; model: string; createdAt: number }
  events: SessionEvent[]
}

/** 将会话事件流转写为可读 Markdown。 */
export function sessionToMarkdown(meta: SessionMeta, events: SessionEvent[]): string {
  const lines: string[] = [
    `# ${meta.title}`,
    '',
    `- 工作区：${meta.workspacePath}`,
    `- 模型：${meta.model || '未指定'} · 权限模式：${permissionLabel(meta.mode)}`,
    `- 创建时间：${new Date(meta.createdAt).toLocaleString()}`,
    '',
    '---',
    ''
  ]
  for (const event of events) {
    const time = new Date(event.createdAt).toLocaleTimeString()
    if (event.type === 'userMessage') {
      lines.push(`## 用户 · ${time}`, '', event.content, '')
      if (event.attachments?.length) lines.push(`> 附件：${event.attachments.map((part) => part.kind).join('、')}`, '')
    } else if (event.type === 'assistantMessage' && event.text.trim()) {
      lines.push(`## 助手 · ${time}`, '', event.text, '')
    } else if (event.type === 'toolResult' && event.result.content) {
      lines.push(`### 工具结果 · ${time}`, '', '```', event.result.content, '```', '')
    } else if (event.type === 'compaction') {
      lines.push(`> ${event.level === 'micro' ? '微压缩' : '上下文压缩'}（${time}）`, '')
    } else if (event.type === 'error') {
      lines.push(`> 错误：${event.message}`, '')
    }
  }
  return lines.join('\n')
}

/** 校验归档结构并返回事件列表与元信息。 */
export function parseSessionArchive(raw: string): { title: string; workspacePath: string; mode: PermissionMode; model: string; events: SessionEvent[] } {
  let archive: SessionArchive
  try {
    archive = JSON.parse(raw) as SessionArchive
  } catch {
    throw new Error('导入文件不是有效的 JSON 归档')
  }
  if (archive.kind !== SESSION_ARCHIVE_KIND || !Array.isArray(archive.events)) {
    throw new Error('导入文件不是 Starbit 会话归档')
  }
  if (!archive.events.every((event) => event && typeof event.type === 'string')) {
    throw new Error('归档事件格式无效')
  }
  return {
    title: `${archive.session?.title ?? '导入会话'}（导入）`,
    workspacePath: archive.session?.workspacePath ?? '',
    mode: archive.session?.mode ?? 'fullAccess',
    model: archive.session?.model ?? '',
    events: archive.events
  }
}

/** 新建会话并写入重映射后的事件（可重复导入同一份归档）。 */
export function importSessionArchive(manager: SessionManager, workspacePath: string, parsed: ReturnType<typeof parseSessionArchive>): SessionMeta {
  const session = manager.create(workspacePath, { title: parsed.title, model: parsed.model, mode: parsed.mode })
  for (const event of parsed.events) {
    manager.append(session.id, { ...event, id: nanoid('event'), sessionId: session.id })
  }
  return session
}

function permissionLabel(mode: PermissionMode): string {
  return mode === 'plan' ? '计划' : mode === 'acceptEdits' ? '自动编辑' : '完全访问'
}
