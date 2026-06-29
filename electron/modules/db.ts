import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'

export interface DownloadRecord {
  id: string
  url: string
  filename: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  status: 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  startedAt: number   // epoch ms — when the download was first started
  completedAt?: number // epoch ms — when it finished/errored/was cancelled
}

const db = new Database(path.join(app.getPath('userData'), 'downloads.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    save_path TEXT NOT NULL,
    total_bytes INTEGER DEFAULT 0,
    received_bytes INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER
  )
`)

function rowToRecord(row: any): DownloadRecord {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    savePath: row.save_path,
    totalBytes: row.total_bytes,
    receivedBytes: row.received_bytes,
    status: row.status,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  }
}

export function getRecord(id: string): DownloadRecord | undefined {
  const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id)
  return row ? rowToRecord(row) : undefined
}

export function getAllRecords(): DownloadRecord[] {
  return db
    .prepare('SELECT * FROM downloads ORDER BY started_at DESC')
    .all()
    .map(rowToRecord)
}

export function upsertRecord(r: DownloadRecord) {
  db.prepare(`
    INSERT INTO downloads (id, url, filename, save_path, total_bytes, received_bytes, status, error, started_at, completed_at)
    VALUES (@id, @url, @filename, @savePath, @totalBytes, @receivedBytes, @status, @error, @startedAt, @completedAt)
    ON CONFLICT(id) DO UPDATE SET
      url = @url,
      filename = @filename,
      save_path = @savePath,
      total_bytes = @totalBytes,
      received_bytes = @receivedBytes,
      status = @status,
      error = @error,
      completed_at = @completedAt
  `).run({ ...r, error: r.error ?? null, completedAt: r.completedAt ?? null })
}

export function deleteRecord(id: string) {
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
}