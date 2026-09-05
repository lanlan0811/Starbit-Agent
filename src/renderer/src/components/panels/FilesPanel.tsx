import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FileText, Folder, RefreshCw, X } from 'lucide-react'
import type { WorkspaceEntryDto } from '../../../../main/workspace/list'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'

interface TreeNode {
  entry: WorkspaceEntryDto
  children: TreeNode[]
  expanded: boolean
}

/** 二级面板 — 工作区文件树：展开折叠、文件预览、一键插入 @引用。 */
export function FilesPanel(): JSX.Element {
  const { t } = useT()
  const workspacePath = useAppStore((state) => state.workspacePath)
  const [entries, setEntries] = useState<WorkspaceEntryDto[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
  const [previewError, setPreviewError] = useState('')

  const refresh = async (): Promise<void> => {
    setError('')
    try {
      setEntries(await window.starbit.workspace.listFiles(workspacePath))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    if (workspacePath) void refresh()
    else {
      setEntries(null)
      setPreview(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  const tree = useMemo(() => buildTree(entries ?? []), [entries])

  const toggle = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openPreview = async (entry: WorkspaceEntryDto): Promise<void> => {
    setPreviewError('')
    setPreview(null)
    try {
      setPreview(await window.starbit.workspace.readFile(workspacePath, entry.path))
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const quoteFile = (entry: WorkspaceEntryDto): void => {
    useAppStore.getState().queueFileRef(entry.path)
  }

  if (!workspacePath) return <p className="panel-empty">{t('files.empty')}</p>
  if (error) return <div className="panel-stack"><p className="panel-empty">{error}</p><button className="panel-button" onClick={() => void refresh()}><RefreshCw size={14} /> 重试</button></div>
  if (!entries) return <p className="panel-empty">{t('files.loading')}</p>

  return (
    <div className="panel-stack files-panel">
      <div className="files-panel__toolbar">
        <span className="files-panel__count">{t('files.count', { count: entries.filter((entry) => !entry.isDir).length })}</span>
        <button className="panel-button" onClick={() => void refresh()} title={t('common.refresh')}><RefreshCw size={13} /></button>
      </div>
      <div className="files-tree" role="tree">
        {tree.map((node) => (
          <TreeRow
            key={node.entry.path}
            node={node}
            depth={0}
            expandedPaths={expanded}
            onToggle={toggle}
            onPreview={openPreview}
            onQuote={quoteFile}
            activePath={preview?.path}
          />
        ))}
        {tree.length === 0 && <p className="panel-empty">{t('files.emptyWorkspace')}</p>}
      </div>
      {(preview || previewError) && (
        <div className="files-preview" role="dialog" aria-label={t('files.preview')}>
          <header>
            <FileText size={13} />
            <span title={preview?.path}>{preview?.path ?? t('files.previewFailed')}</span>
            {preview?.truncated && <em className="files-preview__badge">{t('files.truncatedBadge')}</em>}
            <button onClick={() => { setPreview(null); setPreviewError('') }} title={t('common.close')}><X size={13} /></button>
          </header>
          {previewError && <p className="panel-empty">{previewError}</p>}
          {preview && <pre>{preview.content}</pre>}
        </div>
      )}
    </div>
  )
}

function TreeRow(props: {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onPreview: (entry: WorkspaceEntryDto) => Promise<void>
  onQuote: (entry: WorkspaceEntryDto) => void
  activePath?: string
}): JSX.Element {
  const { t } = useT()
  const { node, depth, expandedPaths, onToggle, onPreview, onQuote, activePath } = props
  const isOpen = expandedPaths.has(node.entry.path)
  return (
    <>
      <div
        className={`files-tree__row ${activePath === node.entry.path ? 'is-active' : ''}`}
        role="treeitem"
        aria-expanded={node.entry.isDir ? isOpen : undefined}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.entry.isDir ? (
          <button className="files-tree__caret" onClick={() => onToggle(node.entry.path)} aria-label={isOpen ? t('files.collapse') : t('files.expand')}>
            <ChevronRight size={12} className={isOpen ? 'is-open' : ''} />
            <Folder size={13} />
          </button>
        ) : (
          <button className="files-tree__caret" onClick={() => void onPreview(node.entry)}>
            <FileText size={13} />
          </button>
        )}
        <span className="files-tree__name" onClick={() => (node.entry.isDir ? onToggle(node.entry.path) : void onPreview(node.entry))}>{node.entry.name}</span>
        {!node.entry.isDir && (
          <button className="files-tree__quote" onClick={() => onQuote(node.entry)} title={t('files.quote')}>@</button>
        )}
      </div>
      {node.entry.isDir && isOpen && node.children.map((child) => (
        <TreeRow key={child.entry.path} node={child} depth={depth + 1} expandedPaths={expandedPaths} onToggle={onToggle} onPreview={onPreview} onQuote={onQuote} activePath={activePath} />
      ))}
    </>
  )
}

/** 由扁平目录项构建树；顺序保持主进程返回（目录展开时子项紧随其后）。 */
function buildTree(entries: WorkspaceEntryDto[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()
  for (const entry of entries) {
    const node: TreeNode = { entry, children: [], expanded: false }
    byPath.set(entry.path, node)
    const slash = entry.path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : entry.path.slice(0, slash)
    const parent = parentPath ? byPath.get(parentPath) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
