// Shared winget plumbing for Lumen's one-click sidecar installs (mpv, yt-dlp,
// ffmpeg). We deliberately do NOT trust winget's exit code for success — it
// returns non-zero when the package is already installed or has no upgrade
// available (0x8A15002B). Callers re-detect the tool on disk as the real
// source of truth. Installs are always user-initiated and surfaced in the UI
// with live status; nothing installs silently.
import { spawn } from 'node:child_process'

export interface WingetOutcome {
  ok: boolean
  reason?: 'no-winget' | 'failed'
}

// Only forward winget's human-meaningful milestone lines to the UI (its raw
// output is full of carriage-return progress bars and spinner glyphs).
const MEANINGFUL = /(Found|Downloading|Verifying|Installing|Successfully|already installed|Starting|Restart|Elevat|Cancel|hash)/i

/** Is winget on PATH? Gates whether we offer one-click installs at all. */
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
 * Install a package by exact winget id for the current user, forwarding
 * milestone status lines to `onProgress`. Resolves when winget exits.
 */
export function wingetInstall(id: string, onProgress: (line: string) => void): Promise<WingetOutcome> {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(
        'winget',
        [
          'install',
          '--exact',
          '--id',
          id,
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
