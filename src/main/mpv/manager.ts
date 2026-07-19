// mpv sidecar manager (main process). Detects an installed mpv, launches it
// for containers/codecs the built-in engine can't handle (MKV/AVI/HEVC/HDR…),
// and bridges JSON IPC so Lumen's controls drive playback and receive live
// position/duration/eof updates. mpv renders in its own GPU window (robust,
// full HDR tone-mapping); Lumen shows a "playing in mpv" panel and transport.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { encodeCommand, parseMessages, cmd, OBSERVED, parseTrackList, type MpvResponse } from './protocol'
import { mpvCandidates, type LocateEnv } from './locate'
import type { HdrMode } from '@shared/types'

type Send = (channel: string, payload: unknown) => void

const toneMap: Record<HdrMode, string[]> = {
  auto: ['--target-colorspace-hint=yes', '--tone-mapping=auto'],
  vivid: ['--target-colorspace-hint=yes', '--tone-mapping=bt.2446a', '--saturation=6'],
  off: ['--tone-mapping=hable', '--target-peak=100']
}

export class MpvManager {
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private buffer = ''
  private reqId = 100
  private pipeName = ''
  private cachedPath: string | null | undefined = undefined
  private trackReqPending = false

  constructor(private send: Send, private locateEnv: () => LocateEnv) {}

  /** Resolve mpv.exe from candidates; cache the result. */
  detect(force = false): string | null {
    if (!force && this.cachedPath !== undefined) return this.cachedPath
    this.cachedPath = mpvCandidates(this.locateEnv()).find((p) => existsSync(p)) ?? null
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

  async load(
    filePath: string,
    opts: { hdr: HdrMode; hwdec: boolean; volume: number; startAt?: number; wid?: number }
  ): Promise<void> {
    const mpv = this.detect()
    if (!mpv) throw new Error('mpv-not-found')
    this.stop()
    this.pipeName = `\\\\.\\pipe\\lumen-mpv-${process.pid}-${Date.now()}`
    // Embedded: render into Lumen's own child window (--wid), no mpv chrome —
    // Lumen's controls drive it. Standalone: mpv's own window + built-in OSC.
    const embed = typeof opts.wid === 'number' && opts.wid > 0
    const windowArgs = embed
      ? [`--wid=${opts.wid}`, '--no-osc', '--osd-level=0', '--no-input-default-bindings', '--input-vo-keyboard=no']
      : ['--force-window=yes', '--osc=yes', '--osd-bar=yes', '--title=Lumen — ${filename}']
    const args = [
      `--input-ipc-server=${this.pipeName}`,
      '--idle=once',
      '--keep-open=yes',
      opts.hwdec ? '--hwdec=auto-safe' : '--hwdec=no',
      '--vo=gpu-next',
      ...toneMap[opts.hdr],
      `--volume=${Math.round(opts.volume * 100)}`,
      ...(opts.startAt && opts.startAt > 1 ? [`--start=${Math.floor(opts.startAt)}`] : []),
      ...windowArgs,
      filePath
    ]
    this.proc = spawn(mpv, args, { windowsHide: false })
    this.proc.on('exit', () => {
      this.send('mpv:event', { type: 'exit' })
      this.cleanup()
    })
    this.proc.on('error', () => {
      this.send('mpv:event', { type: 'error', message: 'mpv failed to start' })
      this.cleanup()
    })
    await this.connect()
  }

  private async connect(attempt = 0): Promise<void> {
    if (attempt > 40) {
      this.send('mpv:event', { type: 'error', message: 'mpv IPC did not come up' })
      return
    }
    await new Promise((r) => setTimeout(r, 100))
    if (!this.proc) return
    const sock = net.connect(this.pipeName)
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
      this.send('mpv:event', { type: 'prop', name: 'eof-reached', data: true })
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
    this.sock?.destroy()
    this.sock = null
    this.buffer = ''
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill() } catch { /* already gone */ }
    }
    this.proc = null
  }
}
