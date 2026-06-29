import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { loadSettings } from './settings'
import { getRecord, getAllRecords, upsertRecord, deleteRecord, DownloadRecord } from './db'

function getDownloadsDir(): string {
  const settings = loadSettings()
  const dir = settings.downloadPath || app.getPath('downloads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || `download-${Date.now()}`
}

// ---------- active in-memory requests (so we can cancel/pause them) ----------

const activeRequests = new Map<string, http.ClientRequest>()
const activeFileStreams = new Map<string, fs.WriteStream>()

// Ids whose request/stream were torn down on purpose (pause or cancel).
// The stream's 'finish'/'error' handlers check this so they don't mistake
// a deliberate stop for a completed or failed download.
const intentionallyStopped = new Set<string>()

// ---------- core download logic ----------

function runDownload(
  id: string,
  url: string,
  savePath: string,
  alreadyReceived: number,
  win: BrowserWindow | null,
  redirectCount = 0,
  suppressStartEvent = false,
  startedAt: number = Date.now() // preserved across redirects/resumes via the params below
) {
  if (redirectCount > 10) {
    win?.webContents.send('download-error', { id, url, error: 'Too many redirects' })
    upsertRecord({
      id, url, filename: path.basename(savePath), savePath,
      totalBytes: 0, receivedBytes: alreadyReceived, status: 'error',
      error: 'Too many redirects', startedAt, completedAt: Date.now(),
    })
    return
  }

  const client = url.startsWith('https') ? https : http
  const reqStartTime = Date.now()

  const requestOptions: http.RequestOptions = {}
  if (alreadyReceived > 0) {
    requestOptions.headers = { Range: `bytes=${alreadyReceived}-` }
  }

  const httpReq = client.get(url, requestOptions, (res) => {
    if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      const nextUrl = new URL(res.headers.location, url).toString()
      runDownload(id, nextUrl, savePath, alreadyReceived, win, redirectCount + 1, suppressStartEvent, startedAt)
      return
    }

    // server doesn't support range resume (200 instead of 206) — restart from scratch
    const isResumed = alreadyReceived > 0 && res.statusCode === 206
    if (alreadyReceived > 0 && res.statusCode === 200) {
      alreadyReceived = 0
    }

    if (res.statusCode && res.statusCode >= 400) {
      const errMsg = `HTTP ${res.statusCode}`
      win?.webContents.send('download-error', { id, url, error: errMsg })
      upsertRecord({
        id, url, filename: path.basename(savePath), savePath,
        totalBytes: 0, receivedBytes: alreadyReceived, status: 'error',
        error: errMsg, startedAt, completedAt: Date.now(),
      })
      return
    }

    const filename = path.basename(savePath)
    const contentLength = parseInt(res.headers['content-length'] || '0', 10)
    const totalBytes = isResumed ? alreadyReceived + contentLength : contentLength

    const fileStream = fs.createWriteStream(savePath, { flags: alreadyReceived > 0 ? 'a' : 'w' })
    activeFileStreams.set(id, fileStream)

    let receivedBytes = alreadyReceived
    let lastEmit = 0
    let lastPersist = 0

    // Sliding window of recent {time, bytes} samples — speed is computed from
    // this short window instead of the average since download start, so it
    // reacts to real network changes (throttling, congestion, server hiccups)
    // instead of slowly drifting based on history.
    const SPEED_WINDOW_MS = 3000
    const speedSamples: { t: number; bytes: number }[] = [{ t: reqStartTime, bytes: alreadyReceived }]

    if (!suppressStartEvent) {
      win?.webContents.send('download-started', { id, url, filename, totalBytes, savePath, startedAt })
    }
    upsertRecord({ id, url, filename, savePath, totalBytes, receivedBytes, status: 'downloading', startedAt })

    res.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length
      const now = Date.now()

      if (now - lastEmit > 100 || receivedBytes === totalBytes) {
        lastEmit = now

        speedSamples.push({ t: now, bytes: receivedBytes })
        while (speedSamples.length > 2 && now - speedSamples[0].t > SPEED_WINDOW_MS) {
          speedSamples.shift()
        }
        const oldest = speedSamples[0]
        const windowElapsedSec = (now - oldest.t) / 1000
        const windowBytes = receivedBytes - oldest.bytes
        const speedBytesPerSec = windowElapsedSec > 0 ? windowBytes / windowElapsedSec : 0

        win?.webContents.send('download-progress', {
          id,
          url,
          filename,
          receivedBytes,
          totalBytes,
          speedBytesPerSec,
        })
      }

      // persist progress every ~1s, not on every chunk, to avoid disk thrashing
      if (now - lastPersist > 1000) {
        lastPersist = now
        upsertRecord({ id, url, filename, savePath, totalBytes, receivedBytes, status: 'downloading', startedAt })
      }
    })

    res.pipe(fileStream)

    fileStream.on('finish', () => {
      activeRequests.delete(id)
      activeFileStreams.delete(id)

      // We deliberately closed this stream early (pause/cancel) — a 'finish'
      // here doesn't mean the file is actually complete, so ignore it.
      if (intentionallyStopped.delete(id)) return

      win?.webContents.send('download-completed', {
        id,
        url,
        filename,
        savePath,
        totalBytes,
        durationMs: Date.now() - reqStartTime,
      })
      upsertRecord({
        id, url, filename, savePath, totalBytes,
        receivedBytes: totalBytes, status: 'completed', startedAt, completedAt: Date.now(),
      })
    })

    fileStream.on('error', (err) => {
      activeFileStreams.delete(id)

      if (intentionallyStopped.delete(id)) return

      win?.webContents.send('download-error', { id, url, error: err.message })
      upsertRecord({
        id, url, filename, savePath, totalBytes, receivedBytes,
        status: 'error', error: err.message, startedAt, completedAt: Date.now(),
      })
    })
  })

  httpReq.on('error', (err: NodeJS.ErrnoException) => {
    activeRequests.delete(id)
    // a cancelled/paused request also fires 'error' (ECONNRESET/ABORT_ERR) —
    // don't report it as a failure if we stopped it ourselves
    if (intentionallyStopped.has(id)) return
    if (err.code === 'ABORT_ERR' || err.message === 'aborted') return
    win?.webContents.send('download-error', { id, url, error: err.message })
  })

  activeRequests.set(id, httpReq)
}

export function startNewDownload(url: string, win: BrowserWindow | null) {
  const id = randomUUID() // allocated first, before anything that could throw

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    win?.webContents.send('download-error', { id, url, error: `Invalid URL: ${url}` })
    return
  }

  let filename = safeFilename(path.basename(parsed.pathname)) || `download-${Date.now()}`
  let savePath = path.join(getDownloadsDir(), filename)
  let counter = 1
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  while (fs.existsSync(savePath)) {
    savePath = path.join(getDownloadsDir(), `${base} (${counter})${ext}`)
    counter++
  }

  runDownload(id, url, savePath, 0, win, 0, false, Date.now())
}

function cancelDownload(id: string, win: BrowserWindow | null) {
  intentionallyStopped.add(id)

  const req = activeRequests.get(id)
  req?.destroy()
  activeRequests.delete(id)

  const stream = activeFileStreams.get(id)
  activeFileStreams.delete(id)

  const entry = getRecord(id) // grab it before finalizing

  const finalize = () => {
    if (entry) {
      upsertRecord({ ...entry, status: 'cancelled', completedAt: Date.now() })
    }
    win?.webContents.send('download-cancelled', { id })
  }

  if (stream) {
    stream.once('close', finalize)
    stream.close()
  } else {
    finalize()
  }
}

// Deletes the file from disk AND removes it from history.
function removeDownload(id: string, win: BrowserWindow | null) {
  const entry = getRecord(id)

  if (!entry) {
    win?.webContents.send('download-removed', { id }) // nothing to clean up, just sync UI
    return
  }

  const finalize = () => {
    deleteRecord(id)
    win?.webContents.send('download-removed', { id })
  }

  if (entry.savePath && fs.existsSync(entry.savePath)) {
    fs.rm(entry.savePath, (err) => {
      if (err) {
        console.error('[downloads] failed to delete file:', err)
        win?.webContents.send('download-error', { id, url: entry.url, error: `Failed to delete file: ${err.message}` })
        return
      }
      finalize()
    })
  } else {
    finalize()
  }
}

// Pauses an in-progress download: stops the network request and write stream,
// but — unlike cancel — keeps the partial file and its record in the DB
// (marked 'paused') so it can be resumed later from where it left off.
function pauseDownload(id: string, win: BrowserWindow | null) {
  const entry = getRecord(id)
  if (!entry || entry.status !== 'downloading') return

  intentionallyStopped.add(id)

  const req = activeRequests.get(id)
  req?.destroy()
  activeRequests.delete(id)

  const stream = activeFileStreams.get(id)
  activeFileStreams.delete(id)

  const finalize = () => {
    const actualBytesOnDisk = fs.existsSync(entry.savePath) ? fs.statSync(entry.savePath).size : entry.receivedBytes
    upsertRecord({ ...entry, receivedBytes: actualBytesOnDisk, status: 'paused' })
    win?.webContents.send('download-paused', {
      id,
      receivedBytes: actualBytesOnDisk,
      totalBytes: entry.totalBytes,
    })
  }

  if (stream) {
    // wait for the write stream to actually flush/close before trusting
    // the file size on disk
    stream.once('close', finalize)
    stream.close()
  } else {
    finalize()
  }
}

// Resumes a previously paused download from the byte offset already on disk.
function resumeDownload(id: string, win: BrowserWindow | null) {
  const entry = getRecord(id)
  if (!entry || entry.status !== 'paused') return

  const actualBytesOnDisk = fs.existsSync(entry.savePath) ? fs.statSync(entry.savePath).size : 0

  win?.webContents.send('download-resumed', {
    id,
    url: entry.url,
    filename: entry.filename,
    savePath: entry.savePath,
    totalBytes: entry.totalBytes,
    receivedBytes: actualBytesOnDisk,
    startedAt: entry.startedAt, // keep the original start time, don't reset the clock
  })

  // suppressStartEvent=true: the renderer already flipped this row back to
  // "downloading" via 'download-resumed' above, so we don't also send
  // 'download-started' (which would reset its displayed progress to 0).
  runDownload(id, entry.url, entry.savePath, actualBytesOnDisk, win, 0, true, entry.startedAt)
}

// ---------- resume incomplete downloads from a previous session ----------

export function resumePendingDownloads(win: BrowserWindow | null) {
  const records = getAllRecords()
  for (const entry of records) {
    if (entry.status === 'downloading' || entry.status === 'paused') {
      const actualBytesOnDisk = fs.existsSync(entry.savePath) ? fs.statSync(entry.savePath).size : 0
      runDownload(entry.id, entry.url, entry.savePath, actualBytesOnDisk, win, 0, false, entry.startedAt)
    }
  }
}

export function registerDownloadHandler(getWin: () => BrowserWindow | null) {
  ipcMain.on('start-download', (_event, url: string) => {
    const win = getWin()
    if (!url || typeof url !== 'string') {
      win?.webContents.send('download-error', { url, error: 'Invalid URL' })
      return
    }
    try {
      new URL(url)
    } catch {
      win?.webContents.send('download-error', { url, error: 'Invalid URL format' })
      return
    }
    startNewDownload(url, win)
  })

  ipcMain.on('cancel-download', (_event, id: string) => {
    cancelDownload(id, getWin())
  })

  ipcMain.on('pause-download', (_event, id: string) => {
    pauseDownload(id, getWin())
  })

  ipcMain.on('resume-download', (_event, id: string) => {
    resumeDownload(id, getWin())
  })

  ipcMain.on('remove-download', (_event, id: string) => {
    removeDownload(id, getWin())
  })

  // Full persistent history (completed/cancelled/error stay forever until removed)
  ipcMain.handle('get-download-history', (): DownloadRecord[] => getAllRecords())
}