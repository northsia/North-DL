// modules/hostInstaller.ts
//
// يتحقق من أن northdl_host.exe مسجَّل في Firefox Native Messaging،
// وإن لم يكن (أو كان flag التحقق غير موجود)، يستدعي:
//     northdl_host.exe --install "<مسار NorthDL.exe الحالي>"
// بصمت تام (بدون نافذة)، ثم يحفظ flag في userData عند النجاح
// لتجنّب إعادة الفحص في كل تشغيل لاحق.

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
    // فشل كتابة الـ flag ليس خطأً قاتلاً، فقط سيُعاد الفحص في المرة القادمة
    console.error('[hostInstaller] failed to write install flag:', err)
  }
}

// يبحث عن northdl_host.exe بجانب الـ exe الحالي لـ NorthDL
// (التوزيع المتوقع: نفس مجلد NorthDL.exe، أو مجلد فرعي "host")
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

// يقرأ مفتاح الـ Registry عبر "reg query" (لا حاجة لمكتبة خارجية)
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
      // الناتج المتوقع يحتوي سطراً مثل:
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
 * يضمن أن تكامل Firefox (Native Messaging Host) مسجَّل بشكل صحيح.
 * لا يفعل شيئاً إذا كان التحقق السابق قد نجح من قبل (flag موجود).
 * صامت تماماً — لا نوافذ، لا تفاعل مع المستخدم.
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