// modules/hostInstaller.ts
//
// Verifies that northdl_host.exe is registered as a Firefox Native
// Messaging host AND that the registration still points at the
// current northdl_host.exe location on disk. If either is missing
// or stale (e.g. the app was moved to a different folder), it
// silently invokes:
//     northdl_host.exe --install "<current NorthDL.exe path>"
// with no window shown, then writes a flag in userData on success
// so we don't have to re-spawn `reg query` + read the manifest on
// every single launch — but the flag is no longer trusted blindly:
// we still re-validate the manifest's recorded path every time, and
// auto-repair (clear stale flag + reinstall) if it no longer matches.

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

function removeInstallFlag(): void {
  try {
    if (fs.existsSync(flagPath())) {
      fs.unlinkSync(flagPath())
      console.log('[hostInstaller] stale flag removed at', flagPath())
    }
  } catch (err) {
    console.error('[hostInstaller] failed to remove stale flag:', err)
  }
}

// Windows paths are case-insensitive, and `--install` may have been
// called with a slightly different but equivalent path (e.g. short
// vs long form). Normalize before comparing.
function pathsEqual(a: string, b: string): boolean {
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  } catch {
    return false
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

  console.log('[hostInstaller] exeDir:', exeDir)
  console.log('[hostInstaller] checking candidates:', candidates)

  for (const c of candidates) {
    const exists = fs.existsSync(c)
    console.log(`[hostInstaller]   ${c} -> ${exists ? 'FOUND' : 'missing'}`)
    if (exists) return c
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
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (err) => {
      console.error('[hostInstaller] reg query spawn error:', err)
      resolve(null)
    })
    proc.on('close', (code) => {
      console.log('[hostInstaller] reg query exit code:', code)
      if (stdout) console.log('[hostInstaller] reg query stdout:', stdout)
      if (stderr) console.log('[hostInstaller] reg query stderr:', stderr)
      if (code !== 0) return resolve(null)
      // Expected output contains a line like:
      //     (Default)    REG_SZ    C:\...\northdl_host.json
      const match = stdout.match(/REG_SZ\s+(.+)/)
      resolve(match ? match[1].trim() : null)
    })
  })
}

// Reads the native messaging manifest itself and returns the "path"
// field, i.e. the host exe location that Firefox will actually
// launch. This is the piece the old code never checked — it only
// checked that *some* json file existed, not that it still pointed
// at a valid, current host exe.
function readManifestHostPath(jsonPath: string): string | null {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8')
    const manifest = JSON.parse(raw)
    if (typeof manifest.path === 'string' && manifest.path.length > 0) {
      return manifest.path
    }
    console.error('[hostInstaller] manifest has no usable "path" field:', jsonPath)
    return null
  } catch (err) {
    console.error('[hostInstaller] failed to read/parse manifest json:', jsonPath, err)
    return null
  }
}

interface RegisteredHostInfo {
  jsonPath: string
  hostExePath: string | null
}

async function getRegisteredHostInfo(): Promise<RegisteredHostInfo | null> {
  const jsonPath = await readRegistryValue()
  console.log('[hostInstaller] registry points to:', jsonPath)
  if (!jsonPath) return null

  const exists = fs.existsSync(jsonPath)
  console.log('[hostInstaller] that json file exists on disk:', exists)
  if (!exists) return null

  const hostExePath = readManifestHostPath(jsonPath)
  console.log('[hostInstaller] manifest declares host exe at:', hostExePath)
  return { jsonPath, hostExePath }
}

function runSilentInstall(hostExe: string, northdlExe: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log('[hostInstaller] spawning:', hostExe, '--install', northdlExe)

    const proc = spawn(hostExe, ['--install', northdlExe], {
      windowsHide: true,
      detached: false,
    })

    proc.on('error', (err) => {
      console.error('[hostInstaller] failed to spawn host --install:', err)
      resolve(false)
    })

    proc.on('close', (code) => {
      console.log('[hostInstaller] --install exit code:', code)
      resolve(code === 0)
    })
  })
}

/**
 * Ensures the Firefox Native Messaging host integration is correctly
 * registered AND that the registration still matches the current
 * northdl_host.exe location on disk.
 *
 * Unlike before, the presence of the flag file is no longer enough
 * on its own to skip the check — we always re-validate the manifest's
 * recorded path against the current host exe location. The flag is
 * only used to skip the (cheap, but non-zero) `reg query` + manifest
 * read on launches where everything already checked out — it is
 * never used to skip a *needed* reinstall, and is auto-cleared and
 * rewritten whenever reality and the flag disagree.
 */
export async function ensureHostInstalled(): Promise<void> {
  console.log('[hostInstaller] ensureHostInstalled() called')

  try {
    const currentHostExe = findHostExe()
    const info = await getRegisteredHostInfo()

    const isStillValid =
      info !== null &&
      info.hostExePath !== null &&
      currentHostExe !== null &&
      pathsEqual(info.hostExePath, currentHostExe)

    if (isStillValid) {
      console.log('[hostInstaller] registration matches current host exe -> OK')
      if (!hasInstallFlag()) {
        // Flag was missing/deleted but registration is genuinely fine —
        // just restore the flag, no need to re-spawn the installer.
        writeInstallFlag()
      }
      return
    }

    // Registration is missing, stale, or pointing at a host exe that
    // no longer matches the current one (e.g. the app was moved).
    // The flag — if present — was lying, so drop it before retrying.
    if (hasInstallFlag()) {
      console.log('[hostInstaller] flag present but registration is stale/invalid -> clearing flag and reinstalling')
      removeInstallFlag()
    } else {
      console.log('[hostInstaller] no valid registration found -> installing')
    }

    if (!currentHostExe) {
      console.error('[hostInstaller] northdl_host.exe not found, skipping install')
      return
    }

    const northdlExe = app.getPath('exe')
    console.log('[hostInstaller] app.getPath("exe") =', northdlExe)

    const ok = await runSilentInstall(currentHostExe, northdlExe)

    if (ok) {
      console.log('[hostInstaller] install succeeded -> writing flag')
      writeInstallFlag()
    } else {
      console.error('[hostInstaller] silent install failed, will retry next launch')
    }
  } catch (err) {
    console.error('[hostInstaller] unexpected error:', err)
  }
}