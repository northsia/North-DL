import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

interface DownloadEntry {
  id: string
  url: string
  filename: string
  totalBytes: number
  receivedBytes: number
  speedBytesPerSec: number
  status: 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  savePath?: string
  startedAt?: number
}

interface ContextMenuState {
  x: number
  y: number
  id: string
}

const SPEED_HISTORY_LENGTH = 40
const CONTEXT_MENU_WIDTH = 200
const CONTEXT_MENU_HEIGHT = 180

type FilterKey = 'all' | 'downloading' | 'completed'

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All downloads',
  downloading: 'Downloading',
  completed: 'Completed',
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(1)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

function formatEta(receivedBytes: number, totalBytes: number, speedBytesPerSec: number): string {
  if (!totalBytes || speedBytesPerSec <= 0) return '—'
  const remaining = totalBytes - receivedBytes
  if (remaining <= 0) return '0s'
  const seconds = remaining / speedBytesPerSec
  if (!isFinite(seconds)) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatStarted(startedAt?: number): string {
  if (!startedAt) return '—'
  return new Date(startedAt).toLocaleString()
}

// Returns the visual treatment (classes + label) for a status pill.
// Centralized so every pill in the UI (list rows, featured card) stays in sync.
function statusPillInfo(status: DownloadEntry['status'], percent: number) {
  switch (status) {
    case 'downloading':
      return {
        label: `${percent}%`,
        className: 'bg-sky-400/10 text-sky-300 border border-sky-400/20',
      }
    case 'paused':
      return {
        label: 'Paused',
        className: 'bg-amber-400/10 text-amber-300 border border-amber-400/25',
      }
    case 'completed':
      return {
        label: 'Completed',
        className: 'bg-white text-black',
      }
    case 'cancelled':
      return {
        label: 'Canceled',
        className: 'bg-red-500/10 text-red-400 border border-red-500/30',
      }
    default:
      return {
        label: 'Error',
        className: 'bg-red-500/20 text-red-400',
      }
  }
}

function SpeedTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rounded-md border border-sky-400/20 bg-black/90 backdrop-blur-xl px-2 py-1 text-[11px] font-mono text-sky-300 shadow-lg shadow-black/40">
      {formatSpeed(payload[0].value)}
    </div>
  )
}

function DetailRow({
  label,
  value,
  valueClassName = 'text-white/70',
  mono = true,
}: {
  label: string
  value: string
  valueClassName?: string
  mono?: boolean
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <span className="w-[72px] text-white/35 shrink-0 text-[11px]">{label}</span>
      <span
        className={'flex-1 min-w-0 block text-[11px] truncate ' + (mono ? 'font-mono ' : '') + valueClassName}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  )
}

function IconInbox() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9.5h3.2l1 1.8h3.6l1-1.8H14" />
      <rect x="2" y="3" width="12" height="10.5" rx="1.5" />
    </svg>
  )
}

function IconDownloadArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v7.5" />
      <path d="M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 13h11" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 6.2 11.5 13 4" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M3.5 4.5 4.1 13a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.6-8.5" />
      <path d="M6.5 7.3v3.6" />
      <path d="M9.5 7.3v3.6" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="3" width="3" height="10" rx="0.6" />
      <rect x="9" y="3" width="3" height="10" rx="0.6" />
    </svg>
  )
}

function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3.1v9.8a0.8 0.8 0 0 0 1.22.68l7.4-4.9a0.8 0.8 0 0 0 0-1.36l-7.4-4.9A0.8 0.8 0 0 0 4.5 3.1Z" />
    </svg>
  )
}

function IconX() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  )
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] transition-colors border ' +
        (active
          ? 'bg-sky-400/10 text-sky-300 border-sky-400/20'
          : 'text-white/50 hover:text-white hover:bg-white/[0.06] border-transparent')
      }
    >
      <span className="shrink-0 [&>svg]:w-[14px] [&>svg]:h-[14px]">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {typeof count === 'number' && (
        <span className={'text-[10px] tabular-nums ' + (active ? 'text-sky-300/70' : 'text-white/30')}>
          {count}
        </span>
      )}
    </button>
  )
}

function ContextMenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-left transition-colors ' +
        (disabled
          ? 'text-white/20 cursor-not-allowed'
          : danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-white/70 hover:text-white hover:bg-white/[0.06]')
      }
    >
      <span className="shrink-0 [&>svg]:w-[13px] [&>svg]:h-[13px]">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

export default function DownloaderView() {
  const handleMinimize = () => window.ipcRenderer?.minimize()
  const handleMaximize = () => window.ipcRenderer?.maximize()
  const handleClose = () => window.ipcRenderer?.close()
  const handleOpenSettings = () => window.ipcRenderer?.openSettings()
  const handleCancel = (id: string) => window.ipcRenderer?.cancelDownload(id)
  const handlePause = (id: string) => window.ipcRenderer?.pauseDownload?.(id)
  const handleResume = (id: string) => window.ipcRenderer?.resumeDownload?.(id)

  const [url, setUrl] = useState('')
  const [downloads, setDownloads] = useState<Record<string, DownloadEntry>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [speedHistory, setSpeedHistory] = useState<number[]>(
    Array(SPEED_HISTORY_LENGTH).fill(0)
  )
  const [peakSpeed, setPeakSpeed] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Refs — declared after `downloads` exists, since downloadsRef reads it immediately.
  const downloadsRef = useRef(downloads)
  downloadsRef.current = downloads
  const peakSpeedRef = useRef(0)
  const speedEmaRef = useRef<Record<string, number>>({})

  // Load persisted history on mount (completed/cancelled/error rows now survive restarts)
  useEffect(() => {
    window.ipcRenderer
      ?.getDownloadHistory?.()
      .then((records: any[]) => {
        if (!records?.length) return
        setDownloads((prev) => {
          const next = { ...prev }
          for (const r of records) {
            if (next[r.id]) continue // don't clobber a live in-progress row
            next[r.id] = {
              id: r.id,
              url: r.url,
              filename: r.filename,
              totalBytes: r.totalBytes,
              receivedBytes: r.receivedBytes,
              speedBytesPerSec: 0,
              status: r.status,
              error: r.error,
              savePath: r.savePath,
              startedAt: r.startedAt,
            }
          }
          return next
        })
      })
      .catch((err: unknown) => console.error('[downloads] failed to load history:', err))
  }, [])

  // Removes a download entry from the list entirely (used after cancel/error/completed).
  const handleRemove = (id: string) => {
    window.ipcRenderer?.removeDownload?.(id)
    delete speedEmaRef.current[id]
    setDownloads((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setExpandedId((prev) => (prev === id ? null : prev))
  }

  const closeContextMenu = () => setContextMenu(null)

  const openContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const x = Math.min(Math.max(8, e.clientX), window.innerWidth - CONTEXT_MENU_WIDTH - 8)
    const y = Math.min(Math.max(8, e.clientY), window.innerHeight - CONTEXT_MENU_HEIGHT - 8)
    setContextMenu({ x, y, id })
  }

  // Close the context menu on outside click, Escape, or scroll.
  useEffect(() => {
    if (!contextMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    const onScroll = () => closeContextMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

  useEffect(() => {
    const onStarted = (_e: unknown, data: any) => {
      setDownloads((prev) => ({
        ...prev,
        [data.id]: {
          id: data.id,
          url: data.url,
          filename: data.filename,
          totalBytes: data.totalBytes || 0,
          receivedBytes: 0,
          speedBytesPerSec: 0,
          status: 'downloading',
          savePath: data.savePath,
          startedAt: data.startedAt,
        },
      }))
    }

    const onProgress = (_e: unknown, data: any) => {
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) return prev

        // Smooth the reported speed with an EMA so the displayed speed/ETA
        // doesn't jitter wildly between progress ticks.
        const prevSpeed = speedEmaRef.current[data.id] ?? data.speedBytesPerSec
        const alpha = 0.25
        const smoothedSpeed = alpha * data.speedBytesPerSec + (1 - alpha) * prevSpeed
        speedEmaRef.current[data.id] = smoothedSpeed

        return {
          ...prev,
          [data.id]: {
            ...existing,
            receivedBytes: data.receivedBytes,
            totalBytes: data.totalBytes,
            speedBytesPerSec: smoothedSpeed,
          },
        }
      })
    }

    const onCompleted = (_e: unknown, data: any) => {
      delete speedEmaRef.current[data.id]
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) return prev
        return {
          ...prev,
          [data.id]: {
            ...existing,
            status: 'completed',
            receivedBytes: data.totalBytes || existing.receivedBytes,
            savePath: data.savePath,
          },
        }
      })
    }

    const onError = (_e: unknown, data: any) => {
      if (!data?.id) {
        console.error('[download-error] event without id, dropped:', data)
        return
      }
      delete speedEmaRef.current[data.id]
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) {
          if (!data.id) return prev
          return {
            ...prev,
            [data.id]: {
              id: data.id,
              url: data.url,
              filename: data.url,
              totalBytes: 0,
              receivedBytes: 0,
              speedBytesPerSec: 0,
              status: 'error',
              error: data.error,
            },
          }
        }
        return { ...prev, [data.id]: { ...existing, status: 'error', error: data.error } }
      })
    }

    const onCancelled = (_e: unknown, data: any) => {
      delete speedEmaRef.current[data.id]
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) return prev
        return { ...prev, [data.id]: { ...existing, status: 'cancelled' } }
      })
    }

    const onPaused = (_e: unknown, data: any) => {
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) return prev
        return { ...prev, [data.id]: { ...existing, status: 'paused' } }
      })
    }

    const onResumed = (_e: unknown, data: any) => {
      setDownloads((prev) => {
        const existing = prev[data.id]
        if (!existing) return prev
        return { ...prev, [data.id]: { ...existing, status: 'downloading', startedAt: data.startedAt ?? existing.startedAt } }
      })
    }

    window.ipcRenderer?.on('download-started', onStarted)
    window.ipcRenderer?.on('download-progress', onProgress)
    window.ipcRenderer?.on('download-completed', onCompleted)
    window.ipcRenderer?.on('download-error', onError)
    window.ipcRenderer?.on('download-cancelled', onCancelled)
    window.ipcRenderer?.on('download-paused', onPaused)
    window.ipcRenderer?.on('download-resumed', onResumed)

    return () => {
      window.ipcRenderer?.off('download-started', onStarted)
      window.ipcRenderer?.off('download-progress', onProgress)
      window.ipcRenderer?.off('download-completed', onCompleted)
      window.ipcRenderer?.off('download-error', onError)
      window.ipcRenderer?.off('download-cancelled', onCancelled)
      window.ipcRenderer?.off('download-paused', onPaused)
      window.ipcRenderer?.off('download-resumed', onResumed)
    }
  }, [])

  // track combined speed across all active downloads, sampled once per second
  useEffect(() => {
    const interval = setInterval(() => {
      const totalSpeed = Object.values(downloadsRef.current)
        .filter((d) => d.status === 'downloading')
        .reduce((sum, d) => sum + d.speedBytesPerSec, 0)

      setSpeedHistory((prev) => [...prev.slice(1), totalSpeed])

      if (totalSpeed > peakSpeedRef.current) {
        peakSpeedRef.current = totalSpeed
        setPeakSpeed(totalSpeed)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleDownload = () => {
    if (!url.trim()) return
    window.ipcRenderer?.startDownload(url.trim())
    setUrl('')
  }

  const list = Object.values(downloads).sort((a, b) => (a.id < b.id ? 1 : -1))
  const activeCount = list.filter((d) => d.status === 'downloading').length
  const completedCount = list.filter((d) => d.status === 'completed').length
  const currentSpeed = speedHistory[speedHistory.length - 1] || 0

  const filteredList = list.filter((d) => {
    if (filter === 'downloading') return d.status === 'downloading' || d.status === 'paused'
    if (filter === 'completed') return d.status === 'completed'
    return true
  })

  const chartData = useMemo(
    () => speedHistory.map((speed, i) => ({ i, speed })),
    [speedHistory]
  )

  const avgSpeed = useMemo(() => {
    const active = speedHistory.filter((s) => s > 0)
    if (!active.length) return 0
    return active.reduce((sum, s) => sum + s, 0) / active.length
  }, [speedHistory])

  const totalDownloaded = useMemo(
    () => list.reduce((sum, d) => sum + d.receivedBytes, 0),
    [list]
  )

  const featuredDownload =
    list.find((d) => d.status === 'downloading' || d.status === 'paused') ?? list[0] ?? null
  const featuredPercent =
    featuredDownload && featuredDownload.totalBytes
      ? Math.round((featuredDownload.receivedBytes / featuredDownload.totalBytes) * 100)
      : 0

  const contextTarget = contextMenu ? downloads[contextMenu.id] : null
  const isContextDownloading = contextTarget?.status === 'downloading'
  const isContextPaused = contextTarget?.status === 'paused'

  return (
    <div className="flex h-screen flex-col bg-black text-white border border-white/10 rounded-xl overflow-hidden">
      {/* Titlebar */}
      <div className="drag-region flex items-center justify-between h-9 shrink-0 border-b border-white/10 bg-white/[0.03] backdrop-blur-xl select-none">
        <div className="flex items-center gap-2 pl-3">
          <span className="text-[11px] font-medium tracking-wide text-white/50">North-DL</span>
          {activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-400/10 text-sky-300 border border-sky-400/20">
              {activeCount} active
            </span>
          )}
        </div>

        <div className="no-drag flex h-full items-center">
          <button
            onClick={handleMinimize}
            aria-label="Minimize"
            className="flex items-center justify-center w-11 h-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button
            onClick={handleMaximize}
            aria-label="Maximize"
            className="flex items-center justify-center w-11 h-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="flex items-center justify-center w-11 h-full text-white/50 hover:text-white hover:bg-red-500 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-[188px] shrink-0 border-r border-white/10 bg-white/[0.02] flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {/* New download */}
            <div className="px-3 pt-3.5 pb-3 border-b border-white/10">
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30 px-0.5">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-sky-400/25 via-sky-500/10 to-transparent border border-sky-400/30 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.25)] [&>svg]:w-2.5 [&>svg]:h-2.5">
                  <IconPlus />
                </span>
                New download
              </label>
              <div className="mt-2 flex flex-col gap-1.5">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
                  placeholder="Paste a link..."
                  title={url || undefined}
                  className="w-full h-8 px-2.5 rounded-md bg-white/5 border border-white/10 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-white/30 focus:bg-white/[0.07] transition-colors truncate"
                />
                <button
                  onClick={handleDownload}
                  disabled={!url.trim()}
                  className="w-full h-8 rounded-md bg-white text-black text-[12px] font-medium hover:bg-white/85 transition-colors disabled:opacity-30 disabled:hover:bg-white disabled:cursor-not-allowed"
                >
                  Download
                </button>
              </div>
            </div>

            {/* Views */}
            <div className="px-2 py-2.5 flex flex-col gap-0.5">
              <SidebarItem
                icon={<IconInbox />}
                label="All"
                count={list.length}
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              />
              <SidebarItem
                icon={<IconDownloadArrow />}
                label="Downloading"
                count={activeCount}
                active={filter === 'downloading'}
                onClick={() => setFilter('downloading')}
              />
              <SidebarItem
                icon={<IconCheck />}
                label="Completed"
                count={completedCount}
                active={filter === 'completed'}
                onClick={() => setFilter('completed')}
              />
            </div>
          </div>

          {/* Settings */}
          <div className="shrink-0 px-2 py-2.5 border-t border-white/10">
            <SidebarItem icon={<IconGear />} label="Settings" onClick={handleOpenSettings} />
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* View header */}
          <div className="shrink-0 px-5 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="text-sm font-medium text-white/80">{FILTER_LABELS[filter]}</span>
            <span className="text-[11px] text-white/30">
              {filteredList.length} {filteredList.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Downloads list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
            {filteredList.length === 0 && (
              <p className="text-center text-white/30 text-sm mt-10">
                {filter === 'all' ? 'No downloads yet' : 'Nothing here yet'}
              </p>
            )}

            {filteredList.map((d) => {
              const percent = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
              const isExpanded = expandedId === d.id
              const pill = statusPillInfo(d.status, percent)
              const showProgress = d.status === 'downloading' || d.status === 'paused'
              const showCancelBtn = d.status === 'downloading' || d.status === 'paused'
              const showRemoveBtn = d.status === 'cancelled' || d.status === 'completed' || d.status === 'error'

              return (
                <div
                  key={d.id}
                  onContextMenu={(e) => openContextMenu(e, d.id)}
                  className={
                    'rounded-xl border bg-white/[0.04] backdrop-blur-xl overflow-hidden transition-colors ' +
                    (contextMenu?.id === d.id ? 'border-sky-400/30' : 'border-white/10')
                  }
                >
                  <div className="w-full flex items-stretch min-w-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}
                      className="flex-1 min-w-0 text-left px-4 py-3 flex flex-col gap-2 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <span className="flex-1 min-w-0 text-sm font-medium truncate" title={d.filename}>
                          {d.filename}
                        </span>
                        <span className={'text-[11px] px-2 py-0.5 rounded-full shrink-0 ' + pill.className}>
                          {pill.label}
                        </span>
                      </div>
                      {showProgress && (
                        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={
                              'h-full transition-all duration-200 ' +
                              (d.status === 'paused'
                                ? 'bg-amber-400/70'
                                : 'bg-gradient-to-r from-sky-500 to-sky-300')
                            }
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}
                    </button>

                    {showCancelBtn && (
                      <button
                        onClick={() => handleCancel(d.id)}
                        aria-label="Cancel download"
                        title="Cancel download"
                        className="w-11 shrink-0 flex items-center justify-center text-white/40 hover:text-white hover:bg-red-500/20 transition-colors border-l border-white/10"
                      >
                        <IconX />
                      </button>
                    )}

                    {showRemoveBtn && (
                      <button
                        onClick={() => handleRemove(d.id)}
                        aria-label="Remove download"
                        title="Remove file"
                        className="w-11 shrink-0 flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors border-l border-white/10"
                      >
                        <IconTrash />
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 border-t border-white/10 space-y-1.5 min-w-0">
                      <DetailRow label="URL" value={d.url} />
                      <DetailRow
                        label="Size"
                        value={`${formatBytes(d.receivedBytes)} ${d.totalBytes ? `/ ${formatBytes(d.totalBytes)}` : ''}`}
                        mono={false}
                      />
                      {d.status === 'downloading' && (
                        <>
                          <DetailRow label="Speed" value={formatSpeed(d.speedBytesPerSec)} mono={false} />
                          <DetailRow
                            label="ETA"
                            value={formatEta(d.receivedBytes, d.totalBytes, d.speedBytesPerSec)}
                            mono={false}
                          />
                        </>
                      )}
                      <DetailRow label="Started" value={formatStarted(d.startedAt)} mono={false} />
                      {d.savePath && <DetailRow label="Saved to" value={d.savePath} />}
                      {d.error && <DetailRow label="Error" value={d.error} valueClassName="text-red-400" mono={false} />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Bottom panel: live speed chart + active download details */}
          <div className="shrink-0 relative border-t border-white/10 overflow-hidden">
            {/* ambient glow */}
            <div className="pointer-events-none absolute -top-16 left-1/3 w-72 h-40 rounded-full bg-sky-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -top-10 right-10 w-40 h-24 rounded-full bg-sky-400/10 blur-3xl" />

            <div className="relative bg-white/[0.02] backdrop-blur-2xl px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    {activeCount > 0 && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400/60" />
                    )}
                    <span
                      className={
                        'relative inline-flex rounded-full h-1.5 w-1.5 ' +
                        (activeCount > 0 ? 'bg-sky-400' : 'bg-white/20')
                      }
                    />
                  </span>
                  <span className="text-[11px] text-white/40 tracking-wide">Network speed</span>
                </div>
                <span className="text-[13px] font-mono font-medium text-sky-300 tabular-nums">
                  {formatSpeed(currentSpeed)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-3">
                {/* Chart card */}
                <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-3 pt-3 pb-2.5">
                  <div className="h-20 -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <YAxis hide domain={[0, (max: number) => Math.max(max * 1.25, 1024)]} />
                        <Tooltip
                          content={<SpeedTooltip />}
                          cursor={{ stroke: 'rgba(56,189,248,0.25)', strokeWidth: 1 }}
                          wrapperStyle={{ outline: 'none' }}
                        />
                        <Area
                          type="monotone"
                          dataKey="speed"
                          stroke="#38bdf8"
                          strokeWidth={1.75}
                          fill="url(#speedGradient)"
                          isAnimationActive={false}
                          dot={false}
                          activeDot={{ r: 3, fill: '#38bdf8', stroke: '#0b1220', strokeWidth: 2 }}
                          style={{ filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.45))' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2.5 border-t border-white/[0.06]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-white/30 uppercase tracking-wider">Peak</span>
                      <span className="text-xs font-mono text-white/80 tabular-nums">{formatSpeed(peakSpeed)}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-white/30 uppercase tracking-wider">Average</span>
                      <span className="text-xs font-mono text-white/80 tabular-nums">{formatSpeed(avgSpeed)}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-white/30 uppercase tracking-wider">Downloaded</span>
                      <span className="text-xs font-mono text-white/80 tabular-nums">{formatBytes(totalDownloaded)}</span>
                    </div>
                  </div>
                </div>

                {/* Active download detail card */}
                <div className="rounded-2xl border border-sky-400/[0.15] bg-gradient-to-b from-sky-500/[0.07] to-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-4 py-3 flex flex-col min-w-0">
                  {featuredDownload ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                        <span className="flex-1 min-w-0 text-[12px] font-medium truncate" title={featuredDownload.filename}>
                          {featuredDownload.filename}
                        </span>
                        {(() => {
                          const fp = statusPillInfo(featuredDownload.status, featuredPercent)
                          return (
                            <span className={'text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ' + fp.className}>
                              {fp.label}
                            </span>
                          )
                        })()}
                      </div>

                      <div className="space-y-1.5 min-w-0">
                        <DetailRow label="URL" value={featuredDownload.url} />
                        <DetailRow
                          label="Size"
                          value={`${formatBytes(featuredDownload.receivedBytes)}${
                            featuredDownload.totalBytes ? ` / ${formatBytes(featuredDownload.totalBytes)}` : ''
                          }`}
                          mono={false}
                        />
                        {featuredDownload.status === 'downloading' && (
                          <>
                            <DetailRow
                              label="Speed"
                              value={formatSpeed(featuredDownload.speedBytesPerSec)}
                              valueClassName="text-sky-300"
                              mono={false}
                            />
                            <DetailRow
                              label="ETA"
                              value={formatEta(
                                featuredDownload.receivedBytes,
                                featuredDownload.totalBytes,
                                featuredDownload.speedBytesPerSec
                              )}
                              valueClassName="text-sky-300"
                              mono={false}
                            />
                          </>
                        )}
                        <DetailRow label="Started" value={formatStarted(featuredDownload.startedAt)} mono={false} />
                        {featuredDownload.savePath && <DetailRow label="Saved to" value={featuredDownload.savePath} />}
                        {featuredDownload.error && (
                          <DetailRow label="Error" value={featuredDownload.error} valueClassName="text-red-400" mono={false} />
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-center text-[11px] text-white/25 py-2">
                      No downloads yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right-click context menu — rendered last so it floats above everything else inside the panel */}
      {contextMenu && contextTarget && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onMouseDown={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          <div
            className="fixed z-50 w-[200px] rounded-lg border border-white/10 bg-[#0a0a0c]/95 backdrop-blur-xl shadow-2xl shadow-black/60 py-1 overflow-hidden"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/25 truncate" title={contextTarget.filename}>
              {contextTarget.filename}
            </div>
            <div className="h-px bg-white/10 mx-1 mb-1" />

            {isContextPaused ? (
              <ContextMenuItem
                icon={<IconPlay />}
                label="Resume download"
                onClick={() => {
                  handleResume(contextMenu.id)
                  closeContextMenu()
                }}
              />
            ) : (
              <ContextMenuItem
                icon={<IconPause />}
                label="Pause download"
                disabled={!isContextDownloading}
                onClick={() => {
                  handlePause(contextMenu.id)
                  closeContextMenu()
                }}
              />
            )}

            <ContextMenuItem
              icon={<IconX />}
              label="Cancel downloading"
              danger
              disabled={!isContextDownloading && !isContextPaused}
              onClick={() => {
                handleCancel(contextMenu.id)
                closeContextMenu()
              }}
            />

            <div className="h-px bg-white/10 mx-1 my-1" />

            <ContextMenuItem
              icon={<IconTrash />}
              label="Remove file"
              danger
              disabled={isContextDownloading || isContextPaused}
              onClick={() => {
                handleRemove(contextMenu.id)
                closeContextMenu()
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}