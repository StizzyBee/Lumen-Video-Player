// Serving the host's film to the rest of the room.
//
// In a streaming room only one person needs the file. Their Lumen serves it
// over the same port the relay already listens on, and everyone else plays it
// as an ordinary remote video — Chromium does the buffering, the seeking and
// the Range requests, and the existing sync engine treats those guests exactly
// like any other watcher.
//
// Two things this is deliberately not: it does not transcode (the host's bytes
// go out untouched), and it does not proxy through a third party (the standalone
// relay has no access to anyone's disk, so streaming rooms must be self-hosted).

import { createReadStream, promises as fsp } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { HTML5_VIDEO_EXTENSIONS } from '@shared/types'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t'
}

export interface StreamSource {
  token: string
  path: string
  size: number
  mime: string
  ext: string
  /** Can a plain browser engine decode this? Guests have nothing else. */
  guestPlayable: boolean
}

export function makeToken(): string {
  return randomBytes(16).toString('hex')
}

export async function describeSource(path: string, token = makeToken()): Promise<StreamSource> {
  const stat = await fsp.stat(path)
  const ext = extname(path).slice(1).toLowerCase()
  return {
    token,
    path,
    size: stat.size,
    mime: MIME[ext] ?? 'application/octet-stream',
    ext,
    // Guests decode in Chromium. An MKV the host plays happily through mpv is
    // a blank screen for everyone else, so the host is warned up front rather
    // than discovering it when nobody can see anything.
    guestPlayable: (HTML5_VIDEO_EXTENSIONS as readonly string[]).includes(ext)
  }
}

/** Parse a Range header against a known size. Null means "send the lot". */
export function parseRange(
  header: string | undefined,
  total: number
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null

  const hasStart = m[1] !== ''
  const hasEnd = m[2] !== ''
  if (!hasStart && !hasEnd) return 'invalid'

  let start: number
  let end: number
  if (!hasStart) {
    // A suffix range ("last N bytes") — used by some players to read trailers.
    const suffix = parseInt(m[2], 10)
    if (Number.isNaN(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = parseInt(m[1], 10)
    end = hasEnd ? parseInt(m[2], 10) : total - 1
    if (Number.isNaN(start) || Number.isNaN(end)) return 'invalid'
    if (end >= total) end = total - 1
  }
  if (start < 0 || start > end || start >= total) return 'invalid'
  return { start, end }
}

/**
 * Serve one registered file. The token is the only way in and maps to a single
 * absolute path chosen by the host, so there is no path to traverse and no
 * directory to enumerate — an unknown token is simply a 404.
 */
export function serveStream(
  req: IncomingMessage,
  res: ServerResponse,
  source: StreamSource | null
): void {
  if (!source) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no such stream')
    return
  }

  const common: Record<string, string> = {
    'Content-Type': source.mime,
    'Accept-Ranges': 'bytes',
    // Guests fetch this from a different origin than their app shell.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...common, 'Content-Length': String(source.size) }).end()
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }

  const range = parseRange(req.headers.range, source.size)
  if (range === 'invalid') {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${source.size}` }).end()
    return
  }

  const start = range ? range.start : 0
  const end = range ? range.end : source.size - 1
  res.writeHead(range ? 206 : 200, {
    ...common,
    'Content-Length': String(end - start + 1),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${source.size}` } : {})
  })

  const file = createReadStream(source.path, { start, end })
  // A guest seeking mid-download aborts the response; tear the read down with
  // it or every scrub leaks a file handle for the rest of the session.
  const cleanup = (): void => {
    file.destroy()
  }
  res.on('close', cleanup)
  file.on('error', () => res.destroy())
  file.pipe(res)
}
