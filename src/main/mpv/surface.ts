import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface SurfaceBounds {
  x: number
  y: number
  width: number
  height: number
}

export type SurfaceInputEvent = 'click' | 'double-click'

/** Keeps MPV's borderless render layer owned, positioned, and hidden with Lumen. */
export class NativeSurfaceHost {
  private proc: ChildProcess | null = null

  constructor(
    private readonly helperPath: string,
    private readonly onInput?: (event: SurfaceInputEvent) => void
  ) {}

  isRunning(): boolean {
    return this.proc !== null
  }

  async create(ownerWid: number, videoWid: number, bounds: SurfaceBounds): Promise<void> {
    this.destroy()
    if (!existsSync(this.helperPath)) throw new Error('mpv-surface-host-missing')
    if (!Number.isSafeInteger(ownerWid) || ownerWid <= 0) throw new Error('mpv-surface-unavailable')
    if (!Number.isSafeInteger(videoWid) || videoWid <= 0) throw new Error('mpv-surface-unavailable')

    const proc = spawn(
      this.helperPath,
      [ownerWid, videoWid, bounds.x, bounds.y, bounds.width, bounds.height].map(String),
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    this.proc = proc
    proc.once('exit', () => {
      if (this.proc === proc) this.proc = null
    })

    return new Promise<void>((resolve, reject) => {
      let output = ''
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        proc.removeListener('error', onError)
        if (error) {
          proc.stdout?.removeAllListeners('data')
          if (this.proc === proc) this.destroy()
          reject(error)
        } else {
          resolve()
        }
      }
      const onError = (): void => finish(new Error('mpv-surface-unavailable'))
      const timer = setTimeout(() => finish(new Error('mpv-surface-timeout')), 3000)
      proc.once('error', onError)
      proc.stdout?.on('data', (chunk) => {
        output += chunk.toString('utf8')
        const lines = output.split(/\r?\n/)
        output = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line) continue
          if (!settled) {
            if (!/^\d+$/.test(line)) continue
            const wid = Number(line)
            finish(wid === videoWid ? undefined : new Error('mpv-surface-unavailable'))
          } else if (line === 'input click') {
            this.onInput?.('click')
          } else if (line === 'input double-click') {
            this.onInput?.('double-click')
          }
        }
      })
    })
  }

  setBounds(bounds: SurfaceBounds): void {
    const proc = this.proc
    if (!proc?.stdin?.writable) return
    proc.stdin.write(`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}\n`)
  }

  destroy(): void {
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try { proc.stdin?.end() } catch { /* process may already be gone */ }
    if (!proc.killed) {
      try { proc.kill() } catch { /* process may already be gone */ }
    }
  }
}
