import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

export interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  theme: 'black-glass'
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function getDefaultSettings(): AppSettings {
  return {
    downloadPath: app.getPath('downloads'),
    maxConcurrentDownloads: 0, // 0 = unlimited
    theme: 'black-glass',
  }
}

export function loadSettings(): AppSettings {
  const settingsPath = getSettingsPath()
  const defaults = getDefaultSettings()

  if (!fs.existsSync(settingsPath)) {
    saveSettings(defaults)
    return defaults
  }

  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return { ...defaults, ...parsed }
  } catch (err) {
    console.error('Failed to read settings.json, falling back to defaults:', err)
    return defaults
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = fs.existsSync(getSettingsPath()) ? loadSettings() : getDefaultSettings()
  const merged = { ...current, ...settings }
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

let settingsWin: BrowserWindow | null = null

export function openSettingsWindow(parent: BrowserWindow | null, preloadPath: string, devServerUrl?: string, rendererDist?: string) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }

  settingsWin = new BrowserWindow({
    width: 420,
    height: 480,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    backgroundColor: '#000000',
    parent: parent || undefined,
    modal: false,
    webPreferences: {
      preload: preloadPath,
    },
  })

  if (devServerUrl) {
    settingsWin.loadURL(`${devServerUrl}#settings`)
  } else if (rendererDist) {
    settingsWin.loadFile(path.join(rendererDist, 'index.html'), { hash: 'settings' })
  }

  settingsWin.on('closed', () => {
    settingsWin = null
  })
}

export function registerSettingsHandlers(getMainWin: () => BrowserWindow | null, preloadPath: string, devServerUrl?: string, rendererDist?: string) {
  ipcMain.handle('get-settings', () => loadSettings())

  ipcMain.handle('save-settings', (_event, settings: Partial<AppSettings>) => {
    const updated = saveSettings(settings)
    // notify main window so it can react to changes (e.g. new download path)
    getMainWin()?.webContents.send('settings-updated', updated)
    return updated
  })

  ipcMain.on('open-settings-window', () => {
    openSettingsWindow(getMainWin(), preloadPath, devServerUrl, rendererDist)
  })

  ipcMain.on('close-settings-window', () => {
    settingsWin?.close()
  })
}