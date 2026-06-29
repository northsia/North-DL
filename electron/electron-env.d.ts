/// <reference types="vite-plugin-electron/electron-env" />
declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

export interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  theme: string
}

export interface DownloadRecord {
  id: string
  url: string
  filename: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  status: 'downloading' | 'paused' | 'completed' | 'cancelled' | 'error'
  error?: string
  startedAt: number
  completedAt?: number
}

declare global {
  // Used in Renderer process, exposed in `preload.ts`
  interface Window {
    ipcRenderer: import('electron').IpcRenderer & {
      minimize: () => void
      maximize: () => void
      close: () => void
      startDownload: (url: string) => void
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
      openSettings: () => void
      closeSettings: () => void
      cancelDownload: (id: string) => void
      pauseDownload: (id: string) => void
      resumeDownload: (id: string) => void
      getDownloadHistory: () => Promise<DownloadHistoryItem[]>
      removeDownload: (id: string) => void
    }
  }
}

export {}