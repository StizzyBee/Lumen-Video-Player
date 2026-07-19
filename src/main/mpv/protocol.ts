// Pure helpers for mpv's JSON IPC (newline-delimited JSON over a named pipe).
// Protocol: https://mpv.io/manual/master/#json-ipc
import type { MpvTrack, MpvTracks } from '@shared/types'
export type { MpvTrack, MpvTracks } from '@shared/types'

export interface MpvCommand {
  command: (string | number | boolean)[]
  request_id?: number
  async?: boolean
}

export interface MpvResponse {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
}

/** Serialize a command to a single newline-terminated JSON line. */
export function encodeCommand(command: MpvCommand['command'], requestId?: number): string {
  const payload: MpvCommand = { command }
  if (requestId !== undefined) payload.request_id = requestId
  return JSON.stringify(payload) + '\n'
}

export const cmd = {
  loadfile: (path: string): MpvCommand['command'] => ['loadfile', path, 'replace'],
  setProp: (name: string, value: string | number | boolean): MpvCommand['command'] => ['set_property', name, value],
  getProp: (name: string): MpvCommand['command'] => ['get_property', name],
  observe: (id: number, name: string): MpvCommand['command'] => ['observe_property', id, name],
  seek: (sec: number): MpvCommand['command'] => ['seek', sec, 'absolute', 'exact'],
  frameStep: (): MpvCommand['command'] => ['frame-step'],
  frameBackStep: (): MpvCommand['command'] => ['frame-back-step'],
  screenshotTo: (path: string): MpvCommand['command'] => ['screenshot-to-file', path, 'video'],
  quit: (): MpvCommand['command'] => ['quit']
}

/**
 * Split an accumulating IPC buffer into complete JSON messages plus any
 * trailing partial line. Feed `rest` back in on the next chunk.
 */
export function parseMessages(buffer: string): { messages: MpvResponse[]; rest: string } {
  const messages: MpvResponse[] = []
  let rest = buffer
  let nl: number
  while ((nl = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as MpvResponse)
    } catch {
      // ignore malformed lines (mpv only ever emits valid JSON lines)
    }
  }
  return { messages, rest }
}

export function isEvent(msg: MpvResponse): msg is MpvResponse & { event: string } {
  return typeof msg.event === 'string'
}

interface RawTrack {
  id?: number
  type?: string
  title?: string
  lang?: string
  codec?: string
  selected?: boolean
}

/** Map mpv's `track-list` into audio + subtitle lists with display labels. */
export function parseTrackList(list: unknown): MpvTracks {
  const out: MpvTracks = { audio: [], sub: [] }
  if (!Array.isArray(list)) return out
  for (const raw of list as RawTrack[]) {
    if (typeof raw?.id !== 'number') continue
    const lang = raw.lang ? raw.lang.toUpperCase() : undefined
    const label =
      raw.title?.trim() ||
      [lang, raw.codec?.toUpperCase()].filter(Boolean).join(' · ') ||
      `Track ${raw.id}`
    const track: MpvTrack = { id: raw.id, label, lang, selected: !!raw.selected }
    if (raw.type === 'audio') out.audio.push(track)
    else if (raw.type === 'sub') out.sub.push(track)
  }
  return out
}

/** Properties Lumen observes for live UI updates, with stable ids. */
export const OBSERVED = [
  { id: 1, name: 'time-pos' },
  { id: 2, name: 'duration' },
  { id: 3, name: 'pause' },
  { id: 4, name: 'eof-reached' },
  { id: 5, name: 'width' },
  { id: 6, name: 'height' },
  { id: 7, name: 'video-codec' },
  { id: 8, name: 'video-params/sig-peak' },
  { id: 9, name: 'paused-for-cache' },
  { id: 10, name: 'track-list' }
] as const
