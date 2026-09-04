import { app, BrowserWindow, shell } from 'electron'
import { isAbsolute, join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { initDatabase } from './session/database'

let mainWindow: BrowserWindow | null = null

const configuredUserDataDir = process.env.STARBIT_USER_DATA_DIR
if (configuredUserDataDir) {
  if (!isAbsolute(configuredUserDataDir)) throw new Error('STARBIT_USER_DATA_DIR 必须是绝对路径')
  app.setPath('userData', configuredUserDataDir)
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: '衔星 | Starbit',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 dev server；生产加载构建产物
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  await initDatabase()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
