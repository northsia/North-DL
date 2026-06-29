/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

export interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  theme: string
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
          getDownloadHistory: () => Promise<DownloadRecord[]>
          removeDownload: (id: string) => void
    }
  }
}

export {}