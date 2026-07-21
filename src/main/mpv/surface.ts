import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface SurfaceBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Owns the true Win32 child HWND that mpv renders into. */
export class NativeSurfaceHost {
  private proc: ChildProcess | null = null

  constructor(private readonly helperPath: string) {}

  isRunning(): boolean {
    return this.proc !== null
  }

  async create(parentWid: number, bounds: SurfaceBounds): Promise<number> {
    this.destroy()
    if (!existsSync(this.helperPath)) throw new Error('mpv-surface-host-missing')
    if (!Number.isSafeInteger(parentWid) || parentWid <= 0) throw new Error('mpv-surface-unavailable')

    const proc = spawn(
      this.helperPath,
      [parentWid, bounds.x, bounds.y, bounds.width, bounds.height].map(String),
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    this.proc = proc
    proc.once('exit', () => {
      if (this.proc === proc) this.proc = null
    })

    return new Promise<number>((resolve, reject) => {
      let output = ''
      let settled = false
      const finish = (error?: Error, wid?: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        proc.stdout?.removeAllListeners('data')
        proc.removeListener('error', onError)
        if (error || !wid) {
          if (this.proc === proc) this.destroy()
          reject(error ?? new Error('mpv-surface-unavailable'))
        } else {
          resolve(wid)
        }
      }
      const onError = (): void => finish(new Error('mpv-surface-unavailable'))
      const timer = setTimeout(() => finish(new Error('mpv-surface-timeout')), 3000)
      proc.once('error', onError)
      proc.stdout?.on('data', (chunk) => {
        output += chunk.toString('utf8')
        const line = output.split(/\r?\n/, 1)[0]?.trim()
        if (!line || !/^\d+$/.test(line)) return
        const wid = Number(line)
        finish(Number.isSafeInteger(wid) && wid > 0 ? undefined : new Error('mpv-surface-unavailable'), wid)
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
