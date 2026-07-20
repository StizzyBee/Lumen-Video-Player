// yt-dlp sidecar manager (main process). Detects an installed yt-dlp (and
// ffmpeg, which it needs to merge 1080p+ video+audio streams), and runs
// downloads into the library's downloads folder with live progress events.
// URLs are validated by the caller and passed after `--` so nothing in them
// can ever be parsed as a flag.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ytdlpCandidates, ffmpegCandidates, type ToolEnv } from './locate'
import { parseYtdlpLine } from './progress'

export interface ToolPaths {
  ytdlp: string | null
  ffmpeg: string | null
}

export type DownloadEventPayload =
  | { type: 'progress'; percent: number }
  | { type: 'status'; text: string }
  | { type: 'done'; path: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

/** Build a download command without exposing process creation to tests. */
export function buildDownloadArgs(url: string, destDir: string, ffmpeg: string | null): string[] {
  // FFmpeg can safely merge separate high-quality streams into MP4. Without
  // it, keep HLS downloads in their native MPEG-TS container: yt-dlp documents
  // this as reducing corruption when a segmented download is interrupted.
  const format = ffmpeg
    ? ['--ffmpeg-location', ffmpeg, '-f', 'bv*+ba/b', '--merge-output-format', 'mp4']
    : ['--hls-use-mpegts', '-f', 'b']
  return [
    '--no-playlist',
    '--newline',
    // --print enables quiet mode; keep progress events flowing to Lumen.
    '--progress',
    '--windows-filenames',
    '--print', 'after_move:__LUMEN_DEST__:%(filepath)s',
    // A movie with missing HLS/DASH fragments is not a successful download.
    '--abort-on-unavailable-fragments',
    '-o', '%(title)s [%(id)s].%(ext)s',
    '-P', destDir,
    ...format,
    '--', url
  ]
}

/**
 * Find an exe inside a winget "portable"/package install by id prefix. yt-dlp
 * sits directly in the package folder; ffmpeg is nested one level down in a
 * versioned "ffmpeg-<ver>\bin" subfolder (pass `nested`). Null if absent.
 */
function wingetPackageExe(
  localAppData: string | undefined,
  idPrefix: string,
  exe: string,
  nested = false
): string | null {
  if (!localAppData) return null
  const packages = join(localAppData, 'Microsoft', 'WinGet', 'Packages')
  let dirs: string[]
  try {
    dirs = readdirSync(packages)
  } catch {
    return null
  }
  for (const dir of dirs) {
    if (!dir.startsWith(idPrefix)) continue
    const base = join(packages, dir)
    const direct = join(base, exe)
    if (existsSync(direct)) return direct
    if (nested) {
      let subs: string[]
      try {
        subs = readdirSync(base)
      } catch {
        continue
      }
      for (const sub of subs) {
        const candidate = join(base, sub, 'bin', exe)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

export class YtdlpManager {
  private jobs = new Map<string, ChildProcess>()
  private cancelledIds = new Set<string>()
  private seq = 1
  private cached: ToolPaths | undefined

  constructor(private env: () => ToolEnv) {}

  detect(force = false): ToolPaths {
    if (!force && this.cached !== undefined) return this.cached
    const e = this.env()
    // Static candidates + PATH first; then scan winget's Packages folder so we
    // find tools even before a shell/app restart picks up the new PATH entries
    // (winget installs yt-dlp/ffmpeg into hashed Packages\<id>_* subfolders).
    this.cached = {
      ytdlp:
        ytdlpCandidates(e).find((p) => existsSync(p)) ??
        wingetPackageExe(e.localAppData, 'yt-dlp.yt-dlp', 'yt-dlp.exe'),
      ffmpeg:
        ffmpegCandidates(e).find((p) => existsSync(p)) ??
        wingetPackageExe(e.localAppData, 'yt-dlp.FFmpeg', 'ffmpeg.exe', true)
    }
    return this.cached
  }

  refresh(): ToolPaths {
    this.cached = undefined
    return this.detect(true)
  }

  /** Start a download; events flow through `onEvent` until done/error/cancelled. */
  download(url: string, destDir: string, onEvent: (e: DownloadEventPayload) => void): string {
    const { ytdlp, ffmpeg } = this.detect()
    if (!ytdlp) throw new Error('ytdlp-not-found')
    const id = `dl-${this.seq++}`
    const args = buildDownloadArgs(url, destDir, ffmpeg)
    const proc = spawn(ytdlp, args, { windowsHide: true })
    this.jobs.set(id, proc)

    let lastDest: string | null = null
    let lastError: string | null = null
    let carry = ''
    const feed = (buf: Buffer): void => {
      const text = carry + buf.toString('utf8')
      const lines = text.split(/\r?\n/)
      carry = lines.pop() ?? ''
      for (const raw of lines) {
        const ev = parseYtdlpLine(raw)
        if (!ev) continue
        if (ev.kind === 'progress') onEvent({ type: 'progress', percent: ev.percent })
        else if (ev.kind === 'status') onEvent({ type: 'status', text: ev.text })
        else if (ev.kind === 'dest') lastDest = ev.path
        else lastError = ev.text
      }
    }
    proc.stdout?.on('data', feed)
    proc.stderr?.on('data', feed)
    proc.on('error', () => {
      this.jobs.delete(id)
      onEvent({ type: 'error', message: 'yt-dlp failed to start' })
    })
    proc.on('exit', (code) => {
      this.jobs.delete(id)
      if (this.cancelledIds.delete(id)) {
        onEvent({ type: 'cancelled' })
      } else if (code === 0 && lastDest && existsSync(lastDest)) {
        onEvent({ type: 'done', path: lastDest })
      } else {
        onEvent({ type: 'error', message: lastError ?? `Download failed (yt-dlp exit ${code})` })
      }
    })
    return id
  }

  cancel(id: string): void {
    const proc = this.jobs.get(id)
    if (!proc) return
    this.cancelledIds.add(id)
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
  }

  stopAll(): void {
    for (const id of this.jobs.keys()) this.cancel(id)
  }
}
