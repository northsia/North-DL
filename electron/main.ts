import { app, BrowserWindow , ipcMain} from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerDownloadHandler, resumePendingDownloads, startNewDownload } from './modules/downloader'
import { registerSettingsHandlers } from './modules/settings'
import { ensureHostInstalled } from './modules/hostInstaller'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))


// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST
const publicDir = process.env.VITE_PUBLIC || RENDERER_DIST

let win: BrowserWindow | null


function createWindow() {
  win = new BrowserWindow({
    frame: false,
    height: 600,
    width: 900,
    backgroundColor: '#0a0a0c',
    icon: path.join(publicDir, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')

    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// App iPc's
ipcMain.on('window-minimize', () => {
  win?.minimize()
})

ipcMain.on('window-maximize', () => {
  if (!win) return
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
})

ipcMain.on('window-close', () => {
  win?.close()
})


process.on('uncaughtException', (err) => {
  fs.appendFileSync(
    path.join(app.getPath('userData'), 'crash.log'),
    `[${new Date().toISOString()}] UNCAUGHT: ${err.stack}\n`
  )
})

process.on('unhandledRejection', (reason) => {
  fs.appendFileSync(
    path.join(app.getPath('userData'), 'crash.log'),
    `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`
  )
})

// Extarcting True URL:**
// Bypassing allow-file-access-from-files
function extractDownloadUrl(argv: string[]): string | null {
  const idx = argv.indexOf('--dw')
  if (idx === -1) return null

  for (let i = idx + 1; i < argv.length; i++) {
    const candidate = argv[i]
    if (candidate.startsWith('--')) continue
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return candidate
  }
  return null
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
  process.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    const idx = argv.indexOf('--dw')
    if (idx !== -1 && argv[idx + 1]) {
      const url = extractDownloadUrl(argv)
      if (url) startNewDownload(url, win)    }
    win?.show()
    win?.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    registerDownloadHandler(() => win)
    registerSettingsHandlers(
      () => win,
      path.join(__dirname, 'preload.mjs'),
      VITE_DEV_SERVER_URL,
      RENDERER_DIST
    )

    // يتحقق بصمت من تسجيل تكامل Firefox، ويصلحه عند الحاجة.
    // لا يحجب بدء التشغيل: يعمل في الخلفية دون انتظار.
    if (process.platform === 'win32') {
      ensureHostInstalled().catch((err) => {
        console.error('[main] ensureHostInstalled failed:', err)
      })
    }

    const idx = process.argv.indexOf('--dw')
    if (idx !== -1 && process.argv[idx + 1]) {
      const url = process.argv[idx + 1]
      win?.webContents.once('did-finish-load', () => {
        startNewDownload(url, win)
      })
    }
    win?.webContents.on('did-finish-load', () => {
      resumePendingDownloads(win)
    })
  })
}