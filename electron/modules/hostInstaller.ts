// modules/hostInstaller.ts
//
// Verifies that northdl_host.exe is registered as a Firefox Native
// Messaging host. If it isn't (or the verification flag is missing),
// it silently invokes:
//     northdl_host.exe --install "<current NorthDL.exe path>"
// with no window shown, then writes a flag in userData on success
// to avoid re-checking on every subsequent launch.

import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const FLAG_FILE = 'host-installed.flag'
const REG_KEY_PATH =
  'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.northdl.host'

function flagPath(): string {
  return path.join(app.getPath('userData'), FLAG_FILE)
}

function hasInstallFlag(): boolean {
  try {
    return fs.existsSync(flagPath())
  } catch {
    return false
  }
}

function writeInstallFlag(): void {
  try {
    fs.writeFileSync(flagPath(), new Date().toISOString(), 'utf-8')
  } catch (err) {
    // Failing to write the flag isn't fatal — it just means we'll
    // re-check again on the next launch.
    console.error('[hostInstaller] failed to write install flag:', err)
  }
}

// Looks for northdl_host.exe next to the current NorthDL.exe
// (expected layout: same folder as NorthDL.exe, or a "host" subfolder).
function findHostExe(): string | null {
  const exeDir = path.dirname(app.getPath('exe'))

  const candidates = [
    path.join(exeDir, 'northdl_host.exe'),
    path.join(exeDir, 'host', 'northdl_host.exe'),
    path.join(exeDir, 'resources', 'host', 'northdl_host.exe'),
  ]

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

// Reads the registry value via "reg query" (no extra dependency needed).
function readRegistryValue(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('reg', ['query', REG_KEY_PATH, '/ve'], {
      windowsHide: true,
    })

    let stdout = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null)
      // Expected output contains a line like:
      //     (Default)    REG_SZ    C:\...\northdl_host.json
      const match = stdout.match(/REG_SZ\s+(.+)/)
      resolve(match ? match[1].trim() : null)
    })
  })
}

async function isHostRegistered(): Promise<boolean> {
  const jsonPath = await readRegistryValue()
  if (!jsonPath) return false
  return fs.existsSync(jsonPath)
}

function runSilentInstall(hostExe: string, northdlExe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(hostExe, ['--install', northdlExe], {
      windowsHide: true,
      detached: false,
    })

    proc.on('error', (err) => {
      console.error('[hostInstaller] failed to spawn host --install:', err)
      resolve(false)
    })

    proc.on('close', (code) => {
      resolve(code === 0)
    })
  })
}

/**
 * Ensures the Firefox Native Messaging host integration is correctly
 * registered. Does nothing if a previous check already succeeded
 * (flag present). Fully silent — no windows, no user interaction.
 */
export async function ensureHostInstalled(): Promise<void> {
  if (hasInstallFlag()) return

  try {
    const registered = await isHostRegistered()
    if (registered) {
      writeInstallFlag()
      return
    }

    const hostExe = findHostExe()
    if (!hostExe) {
      console.error('[hostInstaller] northdl_host.exe not found, skipping install')
      return
    }

    const northdlExe = app.getPath('exe')
    const ok = await runSilentInstall(hostExe, northdlExe)

    if (ok) {
      writeInstallFlag()
    } else {
      console.error('[hostInstaller] silent install failed, will retry next launch')
    }
  } catch (err) {
    console.error('[hostInstaller] unexpected error:', err)
  }
}