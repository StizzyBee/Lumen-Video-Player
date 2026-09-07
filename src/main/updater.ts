// Keeping Lumen current.
//
// The app checks GitHub once at startup and, if there is something newer, asks
// before doing anything. Nothing downloads and nothing installs without the
// user saying yes — `autoDownload` is off precisely so the decision is theirs.
//
// electron-updater rather than a hand-rolled fetch because it verifies the
// sha512 in the release's `latest.yml` before running the installer. Lumen's
// builds are unsigned, so that checksum is the only thing standing between a
// tampered download and an executable launched on the user's machine.

import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateEvent } from '@shared/updates'

// electron-updater is CJS; the named export is not reachable via ESM import.
const { autoUpdater } = electronUpdater

export type { UpdateEvent }

export interface UpdaterDeps {
  win: () => BrowserWindow
}

let wired = false

export function registerUpdater(deps: UpdaterDeps): void {
  if (wired) return
  wired = true

  const send = (e: UpdateEvent): void => {
    const win = deps.win()
    if (!win.isDestroyed()) win.webContents.send('update:event', e)
  }

  // The user decides. Both of these must stay false.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    send({
      type: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })
  autoUpdater.on('update-not-available', () => send({ type: 'none', version: app.getVersion() }))
  autoUpdater.on('download-progress', (p) => {
    send({
      type: 'progress',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total
    })
  })
  autoUpdater.on('update-downloaded', (info) => send({ type: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    // A failed check is not worth interrupting anyone over — it usually just
    // means they are offline. The renderer keeps it quiet unless asked.
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}

/**
 * Look for a newer release. Silent about failure by design: this runs at every
 * startup and an offline launch must not greet the user with an error.
 */
export async function checkForUpdate(): Promise<void> {
  // In development there is no packaged app to replace, and electron-updater
  // throws rather than no-oping.
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* reported through the error event */
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/** Close Lumen and run the installer that was just downloaded and verified. */
export function installUpdate(): void {
  // isSilent false so the user sees the installer; isForceRunAfter so Lumen
  // comes back up afterwards rather than leaving them staring at a desktop.
  autoUpdater.quitAndInstall(false, true)
}
