// mpv sidecar manager (main process). Detects an installed mpv, launches it
// for containers/codecs the built-in engine can't handle (MKV/AVI/HEVC/HDR…),
// and bridges JSON IPC so Lumen's controls drive playback and receive live
// position/duration/eof updates. The video is a borderless, taskbar-hidden
// render layer owned and positioned by Lumen, with no separate player UI.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { encodeCommand, parseMessages, cmd, OBSERVED, parseTrackList, type MpvResponse } from './protocol'
import { mpvCandidates, supportsEmbed, type LocateEnv } from './locate'
import { gradeArgs, gradeProps } from './grade'
import { videoOutputArgs } from './renderer'
import { DEFAULT_SETTINGS, type ColorAdjust, type HdrMode } from '@shared/types'

type Send = (channel: string, payload: unknown) => void

/** MPV creates a hidden render HWND which Lumen immediately adopts as an owned layer. */
export function embeddedWindowArgs(): string[] {
  return [
    '--force-window=yes',
    '--no-border',
    '--show-in-taskbar=no',
    '--taskbar-progress=no',
    '--window-minimized=yes',
    '--geometry=1x1+0+0',
    '--auto-window-resize=no',
    '--keepaspect-window=no',
    '--no-osc', '--osd-level=0', '--no-input-default-bindings', '--input-vo-keyboard=no'
  ]
}

interface PendingRequest {
  resolve: (message: MpvResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class MpvManager {
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private buffer = ''
  private reqId = 100
  private pipeName = ''
  private cachedPath: string | null | undefined = undefined
  private trackReqPending = false
  private pending = new Map<number, PendingRequest>()

  constructor(
    private send: Send,
    private locateEnv: () => LocateEnv,
    private compatibilityRenderer: () => boolean = () => false
  ) {}

  /** Resolve mpv.exe from candidates; cache the result. */
  detect(force = false): string | null {
    if (!force && this.cachedPath !== undefined) return this.cachedPath
    this.cachedPath = mpvCandidates(this.locateEnv()).find((p) => supportsEmbed(p) && existsSync(p)) ?? null
    return this.cachedPath
  }

  /** Re-probe after the user's configured path changed (persisted in settings). */
  refresh(): string | null {
    this.cachedPath = undefined
    return this.detect(true)
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  /** Can the detected executable render into Lumen's window? (mpv.net can't) */
  canEmbed(): boolean {
    const p = this.detect()
    return !!p && supportsEmbed(p)
  }

  async load(
    filePath: string,
    opts: {
      hdr: HdrMode
      color?: ColorAdjust
      hwdec: boolean
      volume: number
      startAt?: number
      /** yt-dlp path so mpv's ytdl hook can resolve website URLs to streams */
      ytdlpPath?: string
    }
  ): Promise<number> {
    const mpv = this.detect()
    if (!mpv) throw new Error('mpv-not-found')
    this.stop()
    this.pipeName = `\\\\.\\pipe\\lumen-mpv-${process.pid}-${Date.now()}`
    // MPV's nested child-window swapchain is black on virtual GPUs. Start its
    // own render HWND hidden; IPC adopts it into Lumen before it is shown.
    const windowArgs = embeddedWindowArgs()
    const args = [
      `--input-ipc-server=${this.pipeName}`,
      '--idle=once',
      '--keep-open=yes',
      ...(this.compatibilityRenderer()
        ? videoOutputArgs(true)
        : [opts.hwdec ? '--hwdec=auto-safe' : '--hwdec=no', ...videoOutputArgs(false)]),
      ...gradeArgs(opts.color ?? DEFAULT_SETTINGS.video.color, opts.hdr),
      `--volume=${Math.round(opts.volume * 100)}`,
      ...(opts.startAt && opts.startAt > 1 ? [`--start=${Math.floor(opts.startAt)}`] : []),
      ...(opts.ytdlpPath ? [`--script-opts=ytdl_hook-ytdl_path=${opts.ytdlpPath}`] : []),
      ...windowArgs,
      '--',
      filePath
    ]
    const proc = spawn(mpv, args, { windowsHide: true })
    this.proc = proc
    // Guard on process identity: when a new load replaces this proc (cleanup
    // nulls this.proc before killing), its late exit must not tear down the
    // NEW session — that would close the player mid queue-advance.
    proc.on('exit', () => {
      if (this.proc !== proc) return
      this.send('mpv:event', { type: 'exit' })
      this.cleanup()
    })
    proc.on('error', () => {
      if (this.proc !== proc) return
      this.send('mpv:event', { type: 'error', message: 'mpv failed to start' })
      this.cleanup()
    })
    await this.connect()
    await this.waitForSocket()
    return this.waitForWindowId()
  }

  /** Apply HDR mode + color adjustments live (same mapping as launch args). */
  applyGrade(color: ColorAdjust, hdr: HdrMode): void {
    for (const [name, value] of Object.entries(gradeProps(color, hdr))) {
      this.write(cmd.setProp(name, value))
    }
  }

  private async connect(attempt = 0): Promise<void> {
    // A new load() rotates the pipe name; abandon retry loops from older loads
    const pipe = this.pipeName
    if (attempt > 40) {
      this.send('mpv:event', { type: 'error', message: 'mpv IPC did not come up' })
      return
    }
    await new Promise((r) => setTimeout(r, 100))
    if (!this.proc || this.pipeName !== pipe) return
    const sock = net.connect(pipe)
    sock.on('connect', () => {
      this.sock = sock
      for (const o of OBSERVED) this.write(cmd.observe(o.id, o.name))
      this.send('mpv:event', { type: 'ready' })
    })
    sock.on('data', (chunk) => this.onData(chunk.toString('utf8')))
    sock.on('error', () => {
      sock.destroy()
      void this.connect(attempt + 1)
    })
    sock.on('close', () => {
      if (this.sock === sock) this.sock = null
    })
  }

  private onData(text: string): void {
    const { messages, rest } = parseMessages(this.buffer + text)
    this.buffer = rest
    for (const m of messages) this.relay(m)
  }

  private relay(m: MpvResponse): void {
    if (m.request_id) {
      const pending = this.pending.get(m.request_id)
      if (pending) {
        this.pending.delete(m.request_id)
        clearTimeout(pending.timer)
        pending.resolve(m)
        return
      }
    }
    if (m.event === 'property-change' && m.name) {
      if (m.name === 'track-list') {
        this.send('mpv:event', { type: 'tracks', data: parseTrackList(m.data) })
      } else {
        this.send('mpv:event', { type: 'prop', name: m.name, data: m.data })
      }
    } else if (m.event === 'file-loaded') {
      this.write(['get_property', 'track-list'])
      this.trackReqPending = true
    } else if (m.event === 'end-file') {
      // Only a real end-of-file counts; quit/stop/replace must not trigger
      // the end-of-video action (auto-next would fire while shutting down).
      if (m.reason === 'eof') this.send('mpv:event', { type: 'prop', name: 'eof-reached', data: true })
    } else if (m.request_id && this.trackReqPending && Array.isArray(m.data)) {
      this.trackReqPending = false
      this.send('mpv:event', { type: 'tracks', data: parseTrackList(m.data) })
    }
  }

  setAudioTrack(id: number): void { this.write(cmd.setProp('aid', id)) }
  setSubTrack(id: number | 'no'): void { this.write(cmd.setProp('sid', id)) }

  private write(command: (string | number | boolean)[]): void {
    if (!this.sock) return
    this.sock.write(encodeCommand(command, this.reqId++))
  }

  private request(command: (string | number | boolean)[], timeoutMs = 750): Promise<MpvResponse> {
    const sock = this.sock
    if (!sock) return Promise.reject(new Error('mpv-ipc-unavailable'))
    const requestId = this.reqId++
    return new Promise<MpvResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('mpv-ipc-timeout'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        sock.write(encodeCommand(command, requestId))
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('mpv-ipc-unavailable'))
      }
    })
  }

  private async waitForSocket(): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (this.sock) return
      if (!this.proc) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('mpv-ipc-unavailable')
  }

  private async waitForWindowId(): Promise<number> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!this.proc) break
      try {
        const response = await this.request(cmd.getProp('window-id'))
        const wid = Number(response.data)
        if (response.error === 'success' && Number.isSafeInteger(wid) && wid > 0) return wid
      } catch {
        // The VO window can appear a few frames after the IPC socket.
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('mpv-surface-unavailable')
  }

  // ── transport (called from renderer via IPC) ──
  play(): void { this.write(cmd.setProp('pause', false)) }
  pause(): void { this.write(cmd.setProp('pause', true)) }
  seek(sec: number): void { this.write(cmd.seek(sec)) }
  setRate(r: number): void { this.write(cmd.setProp('speed', r)) }
  setVolume(v: number): void { this.write(cmd.setProp('volume', Math.round(v * 100))) }
  setMuted(m: boolean): void { this.write(cmd.setProp('mute', m)) }
  frameStep(dir: 1 | -1): void { this.write(dir > 0 ? cmd.frameStep() : cmd.frameBackStep()) }
  /** Ask mpv to write the current video frame (no OSD/subs) to an absolute path. */
  screenshot(path: string): void { this.write(cmd.screenshotTo(path)) }

  stop(): void {
    if (this.sock) {
      try { this.write(cmd.quit()) } catch { /* socket may be gone */ }
    }
    this.cleanup()
  }

  private cleanup(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('mpv-stopped'))
    }
    this.pending.clear()
    this.sock?.destroy()
    this.sock = null
    this.buffer = ''
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill() } catch { /* already gone */ }
    }
    this.proc = null
  }
}
