// Optional one-click mpv install via winget (the Windows Package Manager, which
// ships with Windows 10/11). We deliberately do NOT trust winget's exit code
// for success — it returns non-zero when the package is already installed or
// has no upgrade available (0x8A15002B). The caller re-detects mpv on disk as
// the real source of truth. Installs are always user-initiated and surfaced in
// the UI with live status; nothing installs silently.
import { spawn } from 'node:child_process'

export type InstallReason = 'no-winget' | 'failed'
export interface InstallOutcome {
  ok: boolean
  reason?: InstallReason
}

// Only forward winget's human-meaningful milestone lines to the UI (its raw
// output is full of carriage-return progress bars and spinner glyphs).
const MEANINGFUL = /(Found|Downloading|Verifying|Installing|Successfully|already installed|Starting|Restart|Elevat|Cancel|hash)/i

/** Is winget on PATH? Gates whether we offer the one-click install at all. */
export function hasWinget(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    try {
      const p = spawn('winget', ['--version'], { windowsHide: true })
      p.on('error', () => done(false))
      p.on('exit', (code) => done(code === 0))
    } catch {
      done(false)
    }
  })
}

/**
 * Install mpv.net for the current user via winget, forwarding milestone status
 * lines to `onProgress`. Resolves when winget exits; the caller confirms success
 * by re-checking whether mpv now exists on disk.
 */
export function installMpvViaWinget(onProgress: (line: string) => void): Promise<InstallOutcome> {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(
        'winget',
        [
          'install',
          '--exact',
          '--id',
          'mpv.net',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity'
        ],
        { windowsHide: true }
      )
    } catch {
      resolve({ ok: false, reason: 'no-winget' })
      return
    }
    proc.on('error', () => resolve({ ok: false, reason: 'no-winget' }))
    const relay = (buf: Buffer): void => {
      for (const raw of buf.toString('utf8').split(/[\r\n]+/)) {
        const line = raw.trim()
        if (line && MEANINGFUL.test(line)) onProgress(line.slice(0, 120))
      }
    }
    proc.stdout?.on('data', relay)
    proc.stderr?.on('data', relay)
    proc.on('exit', (code) => resolve({ ok: code === 0, reason: code === 0 ? undefined : 'failed' }))
  })
}
