import { useEffect, useState } from 'react'
import type { AppSettings } from '../vite-env'

export default function SettingsView() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.ipcRenderer?.getSettings().then((s: AppSettings) => setSettings(s))
  }, [])

  const handleClose = () => window.ipcRenderer?.closeSettings()

  const handleSave = async () => {
    if (!settings) return
    await window.ipcRenderer?.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white/40 text-sm">
        Loading settings...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-black text-white border border-white/10 rounded-xl overflow-hidden">
      <div className="drag-region flex items-center justify-between h-9 shrink-0 border-b border-white/10 bg-white/[0.03] backdrop-blur-xl select-none">
        <span className="pl-3 text-[11px] font-medium tracking-wide text-white/50">Settings</span>
        <button
          onClick={handleClose}
          aria-label="Close"
          className="no-drag flex items-center justify-center w-11 h-full text-white/50 hover:text-white hover:bg-red-500 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="space-y-2">
          <label className="text-xs text-white/40">Download folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.downloadPath}
              onChange={(e) => setSettings({ ...settings, downloadPath: e.target.value })}
              className="flex-1 h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-white/40">Max concurrent downloads</label>
          <input
            type="number"
            min={0}
            value={settings.maxConcurrentDownloads}
            onChange={(e) =>
              setSettings({ ...settings, maxConcurrentDownloads: parseInt(e.target.value, 10) || 0 })
            }
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-white/30 transition-colors"
          />
          <p className="text-[11px] text-white/30">0 means unlimited</p>
        </div>
      </div>

      <div className="shrink-0 px-5 py-4 border-t border-white/10 flex items-center justify-between">
        <span className="text-[11px] text-white/30">
          {saved ? 'Saved' : 'settings.json'}
        </span>
        <button
          onClick={handleSave}
          className="h-9 px-5 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/85 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}