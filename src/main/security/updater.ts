import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 本地错误报告目录（userData/error-reports.log） */
export function errorReportPath(): string {
  return join(app.getPath('userData'), 'error-reports.log')
}

export interface LocalErrorReport {
  kind: string
  time: string
  version: string
  platform: string
  message: string
  stack?: string
}

/** 读取最近的本地错误报告（新的在前，最多 limit 条）。 */
export function listErrorReports(limit = 20): LocalErrorReport[] {
  const path = errorReportPath()
  if (!existsSync(path)) return []
  try {
    // 日志单文件增长可控；超过 256KB 时截断保留尾部，防止无限膨胀
    if (statSync(path).size > 256 * 1024) {
      const content = readFileSync(path, 'utf8').split('\n')
      writeFileSync(path, content.slice(-200).join('\n'), 'utf8')
    }
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).reverse().map((line) => {
      try { return JSON.parse(line) as LocalErrorReport } catch { return { kind: 'raw', time: '', version: '', platform: '', message: line } }
    })
  } catch {
    return []
  }
}

function appendReport(kind: string, error: unknown): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const entry = JSON.stringify({
      kind,
      time: new Date().toISOString(),
      version: app.getVersion(),
      platform: `${process.platform} ${process.arch}`,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    appendFileSync(errorReportPath(), `${entry}\n`, 'utf8')
  } catch {
    // 错误报告自身失败时静默，避免崩溃循环
  }
}

/** 注册本地错误报告：主进程未捕获异常/拒绝、渲染进程与子进程异常。 */
export function registerErrorReporting(): void {
  process.on('uncaughtException', (error) => appendReport('uncaughtException', error))
  process.on('unhandledRejection', (reason) => appendReport('unhandledRejection', reason))
  app.on('render-process-gone', (_event, _webContents, details) => appendReport('render-process-gone', new Error(`${details.reason} (${details.exitCode})`)))
  app.on('child-process-gone', (_event, details) => appendReport('child-process-gone', new Error(`${details.type} ${details.reason} (${details.exitCode})`)))
}

/** 注册自动更新（生产环境；feed 由 electron-builder.yml 的 publish 段配置）。 */
export function registerAutoUpdater(): void {
  autoUpdater.logger = null
  autoUpdater.on('update-downloaded', async (info) => {
    const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    if (!win) return
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '更新就绪',
      message: `新版本 ${info.version} 已下载完成，是否立即重启安装？`,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (error) => appendReport('auto-update', error))
  // 打包环境启动 5 秒后做一次后台检查；失败静默（无网络/feed 不可达不影响使用）
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  }, 5_000)
}
