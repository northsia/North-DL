import { ipcRenderer, contextBridge } from 'electron'
// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
  // other APTs you need here.
  // ...
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  startDownload: (url: string) => ipcRenderer.send('start-download', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.send('open-settings-window'),
  closeSettings: () => ipcRenderer.send('close-settings-window'),
  cancelDownload: (id: string) => ipcRenderer.send('cancel-download', id),
  pauseDownload: (id: string) => ipcRenderer.send('pause-download', id),
  resumeDownload: (id: string) => ipcRenderer.send('resume-download', id),
  removeDownload: (id: string) => ipcRenderer.send('remove-download', id),
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
})