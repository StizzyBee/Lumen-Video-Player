// Pure helpers for streaming remote URLs. A stream plays through the normal
// player pipeline as a synthetic (never persisted) LibraryItem whose `path`
// is the URL itself. Unit-tested.
import type { LibraryItem } from '@shared/types'

const STREAM_ID_PREFIX = 'url:'

/** Direct-file extensions the built-in engine can stream without mpv. */
const HTML5_STREAMABLE = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])

/**
 * Normalize user input into a playable http(s) URL, or null if it isn't one.
 * Bare domains get https:// prefixed ("youtube.com/…" works when pasted).
 */
export function normalizeStreamUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+([/:?#]|$)/.test(raw) ? `https://${raw}` : null
  if (!candidate) return null
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** File extension from the URL path, if it names a media file. */
export function streamExt(url: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)
    return m ? m[1].toLowerCase() : ''
  } catch {
    return ''
  }
}

/** True when the URL points straight at a file the built-in engine can play. */
export function isDirectMediaUrl(url: string): boolean {
  return HTML5_STREAMABLE.has(streamExt(url))
}

/** Human title: the file name for direct links, otherwise the site host. */
export function streamTitle(url: string): string {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return last.replace(/\.[a-z0-9]{2,5}$/i, '')
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Synthetic LibraryItem for a stream. Never persisted; id marks it as such. */
export function makeStreamItem(url: string): LibraryItem {
  return {
    id: `${STREAM_ID_PREFIX}${url}`,
    path: url,
    fileName: streamTitle(url),
    title: streamTitle(url),
    folder: '',
    ext: streamExt(url),
    sizeBytes: 0,
    mtimeMs: 0,
    addedAt: Date.now(),
    favorite: false,
    pinned: false,
    tags: [],
    playCount: 0,
    subtitles: []
  }
}

export function isStreamItem(item: Pick<LibraryItem, 'id'>): boolean {
  return item.id.startsWith(STREAM_ID_PREFIX)
}
