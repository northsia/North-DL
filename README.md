
# NorthDL

![NorthDL Logo](https://github.com/user-attachments/assets/3bd10c93-3e43-4b18-bcdf-90633852892b)

A fast, lightweight desktop download manager built with **Electron**, **React**, **TypeScript**, **Vite**, and **Tailwind CSS**.

NorthDL handles downloads outside the browser: pause/resume, automatic recovery after a crash or restart, real-time speed/ETA, persistent history, and an optional Firefox integration so the browser can hand downloads off to the app directly.

---

## Features

- **Pause / resume / cancel** — pausing keeps the partial file on disk; resuming continues from the exact byte offset using HTTP `Range` requests (falls back to a clean restart if the server doesn't support ranges).
- **Crash & restart recovery** — any download still marked `downloading` or `paused` when the app last closed is automatically picked back up on the next launch.
- **Real-time speed & ETA** — throughput is computed from a short sliding time window (not a lifetime average), so the displayed speed reacts to real network conditions instead of drifting slowly.
- **Persistent history** — every download (completed, cancelled, or failed) is stored via SQLite (`better-sqlite3`) and stays in history until explicitly removed.
- **Remove vs. Cancel** — cancelling stops an active download but keeps its history entry; removing deletes the file from disk *and* the history entry.
- **Redirect handling** — follows up to 10 redirects safely before failing out.
- **Custom frameless window** — a borderless window with its own draggable region and native-feel minimize / maximize / close controls over IPC.
- **Single-instance app** — launching NorthDL while it's already running focuses the existing window instead of opening a second one.
- **CLI download trigger** — start a download straight from the command line, even while NorthDL is already running:
  ```bash
  NorthDL.exe --dw "https://example.com/file.zip"
  ```
  If an instance is already open, the URL is routed to it via Electron's single-instance lock instead of opening a duplicate window.
- **Browser hand-off (Windows)** — NorthDL can register itself as a Firefox **Native Messaging** host, allowing a companion browser extension to send downloads directly to the app. Registration is verified and self-healed automatically on every launch (no user action needed, even if the app folder moves).

## Tech Stack

| Layer        | Tech                                  |
|--------------|----------------------------------------|
| Shell        | Electron                              |
| UI           | React + TypeScript + Vite             |
| Styling      | Tailwind CSS                          |
| Storage      | SQLite (`better-sqlite3`)             |
| Networking   | Node's built-in `http` / `https`      |

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS recommended)
- npm

### Installation
```bash
git clone https://github.com/<your-username>/northdl.git
cd northdl
npm install
```

### Development
```bash
npm run dev
```
Runs the Vite dev server for the renderer alongside the Electron main process with hot reload.

### Build
```bash
npm run build
```
Produces a production build (renderer bundle + compiled Electron main/preload) ready for packaging.

> Adjust the script names above if your `package.json` uses different ones.

## Usage

1. Launch NorthDL and paste a URL to start a download, **or**
2. Trigger a download from outside the app:
   ```bash
   NorthDL.exe --dw "https://example.com/file.zip"
   ```
3. Manage active downloads from the app — pause, resume, or cancel at any time. Paused downloads survive an app restart and resume from where they left off.

### Browser Extension (Windows only)
On first launch on Windows, NorthDL silently registers `northdl_host.exe` as a Firefox Native Messaging host (no dialogs, no user interaction). This lets a paired browser extension forward downloads to NorthDL instead of the browser's own download manager. If the app is moved to a different folder, the registration is detected as stale and automatically repaired on the next launch.

## Project Structure

```
.
├── electron/
│   ├── main.ts                 # App entry: window creation, single-instance lock, CLI (--dw) handling
│   └── modules/
│       ├── downloader.ts       # Core download engine: start/pause/resume/cancel, progress, history
│       ├── settings.ts         # User settings (download path, etc.)
│       ├── hostInstaller.ts    # Firefox Native Messaging host registration (Windows)
│       └── db.ts                # SQLite-backed download record storage
├── src/                        # React + Tailwind renderer (UI)
└── ...
```

## How Downloads Work

Each download moves through a simple state machine, persisted to SQLite at every step:

```
downloading ──▶ completed
     │
     ├──▶ paused ──▶ downloading (resume)
     │
     ├──▶ cancelled
     │
     └──▶ error
```

- **Progress** events are throttled to roughly every 100ms (or on completion) to keep the renderer responsive without flooding IPC.
- **History writes** to SQLite are throttled to roughly once per second during an active download, then written precisely on completion, pause, cancel, or error.

## Contributing

Issues and pull requests are welcome. If you're adding a feature, please keep the download engine's event contract (`download-started`, `download-progress`, `download-completed`, `download-paused`, `download-resumed`, `download-cancelled`, `download-removed`, `download-error`) intact so the renderer doesn't need changes.

## License

[MIT](LICENSE) — replace with your actual license if different.
