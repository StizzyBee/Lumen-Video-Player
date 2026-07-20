// lumen:// — the app's privileged asset protocol.
//   lumen://media/?p=<encoded absolute path>   → Range-streamed video/subtitle bytes
//   lumen://thumb/<id>                         → cached thumbnail JPEG
// The renderer is sandboxed; this is its only route to file bytes, and every
// request is checked against the allowlist of library roots + session files.
import { protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { dirname, extname, join, normalize } from 'node:path'
import { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } from '@shared/types'

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  mov: 'video/quicktime', avi: 'video/x-msvideo', divx: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf', flv: 'video/x-flv', f4v: 'video/mp4',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', mpe: 'video/mpeg', m1v: 'video/mpeg',
  m2v: 'video/mpeg', vob: 'video/mpeg', ts: 'video/mp2t', m2ts: 'video/mp2t',
  mts: 'video/mp2t', mod: 'video/mp2t', tod: 'video/mp2t', mxf: 'application/mxf',
  ogv: 'video/ogg', ogm: 'video/ogg', '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
  rm: 'application/vnd.rn-realmedia', rmvb: 'application/vnd.rn-realmedia-vbr',
  dv: 'video/dv', wtv: 'video/x-ms-wtv', 'dvr-ms': 'video/x-ms-dvr',
  srt: 'text/plain', vtt: 'text/vtt', jpg: 'image/jpeg'
}
const STREAMABLE = new Set<string>([...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS])

export class PathGuard {
  private roots = new Set<string>()
  private dirs = new Set<string>()

  private norm(p: string): string {
    return normalize(p).replace(/[\\/]+$/, '').toLowerCase()
  }
  setRoots(folders: string[]): void {
    this.roots = new Set(folders.map((f) => this.norm(f)))
  }
  /** Allow a loose file's directory (drag-drop, dialog, file association) */
  allowFileDir(filePath: string): void {
    this.dirs.add(this.norm(dirname(filePath)))
  }
  isAllowed(filePath: string): boolean {
    const ext = extname(filePath).slice(1).toLowerCase()
    if (!STREAMABLE.has(ext)) return false
    const n = this.norm(filePath)
    for (const d of this.dirs) if (dirname(n) === d || n.startsWith(d + '\\') || n.startsWith(d + '/')) return true
    for (const r of this.roots) if (n.startsWith(r + '\\') || n.startsWith(r + '/')) return true
    return false
  }
}

export const pathGuard = new PathGuard()

export function registerLumenScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lumen',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
    }
  ])
}

export function mediaUrl(path: string): string {
  return `lumen://media/?p=${encodeURIComponent(path)}`
}
export function thumbUrl(id: string): string {
  return `lumen://thumb/${id}`
}

export function installLumenProtocol(thumbsDir: string): void {
  protocol.handle('lumen', async (request) => {
    const url = new URL(request.url)
    try {
      if (url.host === 'thumb') {
        const id = url.pathname.replace(/^\//, '')
        if (!/^[a-f0-9]{16,64}$/.test(id)) return new Response('bad id', { status: 400 })
        const file = join(thumbsDir, `${id}.jpg`)
        const buf = await fsp.readFile(file)
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      if (url.host === 'media') {
        const p = url.searchParams.get('p')
        if (!p || !pathGuard.isAllowed(p)) return new Response('forbidden', { status: 403 })
        const stat = await fsp.stat(p)
        const total = stat.size
        const mime = MIME[extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream'
        const range = request.headers.get('Range')

        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          let start = m?.[1] ? parseInt(m[1], 10) : 0
          let end = m?.[2] ? parseInt(m[2], 10) : total - 1
          if (Number.isNaN(start) || start < 0) start = 0
          if (Number.isNaN(end) || end >= total) end = total - 1
          if (start > end) return new Response(null, { status: 416 })
          const stream = createReadStream(p, { start, end })
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Access-Control-Allow-Origin': '*'
            }
          })
        }

        const stream = createReadStream(p)
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(total),
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      return new Response('not found', { status: 404 })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
