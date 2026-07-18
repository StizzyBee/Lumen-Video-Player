// SRT / VTT parsing and cue selection. Pure logic, unit-tested.

export interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

export interface SubtitleTrack {
  id: string
  label: string
  path?: string
  cues: SubtitleCue[]
}

const TIME_SRT = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
const TIME_VTT_SHORT = /(\d{1,2}):(\d{2})[,.](\d{1,3})/

function parseTimestamp(raw: string): number | null {
  const t = raw.trim()
  let m = TIME_SRT.exec(t)
  if (m) {
    return (
      parseInt(m[1], 10) * 3_600_000 +
      parseInt(m[2], 10) * 60_000 +
      parseInt(m[3], 10) * 1000 +
      parseInt(m[4].padEnd(3, '0'), 10)
    )
  }
  m = TIME_VTT_SHORT.exec(t)
  if (m) {
    return parseInt(m[1], 10) * 60_000 + parseInt(m[2], 10) * 1000 + parseInt(m[3].padEnd(3, '0'), 10)
  }
  return null
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')       // html-ish tags <i> <font …>
    .replace(/\{\\[^}]*\}/g, '')   // ASS override blocks {\an8}
    .trim()
}

/** Parses SRT and (basic) WebVTT. Returns cues sorted by start time. */
export function parseSubtitles(raw: string): SubtitleCue[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues: SubtitleCue[] = []
  const blocks = text.split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    let i = 0
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE/i.test(lines[0]) || /^STYLE/i.test(lines[0])) continue
    // optional numeric index (SRT) or cue id (VTT)
    if (!lines[i].includes('-->') && lines[i + 1]?.includes('-->')) i++
    const timeLine = lines[i]
    if (!timeLine?.includes('-->')) continue
    const [a, b] = timeLine.split('-->')
    const start = parseTimestamp(a ?? '')
    const end = parseTimestamp((b ?? '').split(' ')[1] ?? b ?? '')
    if (start === null || end === null || end <= start) continue
    const body = lines
      .slice(i + 1)
      .map(stripMarkup)
      .filter(Boolean)
      .join('\n')
    if (body) cues.push({ startMs: start, endMs: end, text: body })
  }
  cues.sort((x, y) => x.startMs - y.startMs)
  return cues
}

/** Active cues at time `ms` with `delayMs` applied (positive delay = subtitles later). */
export function activeCues(cues: SubtitleCue[], ms: number, delayMs = 0): SubtitleCue[] {
  const t = ms - delayMs
  const out: SubtitleCue[] = []
  // cues lists are small (thousands) — linear scan with early exit is plenty
  for (const c of cues) {
    if (c.startMs > t) break
    if (c.endMs > t) out.push(c)
  }
  return out
}

/** "Movie.en.srt" → "EN"; "Movie.srt" → "Subtitles" */
export function trackLabelFromPath(path: string, videoStem?: string): string {
  const file = path.split(/[\\/]/).pop() ?? path
  const stem = file.replace(/\.[^.]+$/, '')
  const rest = videoStem && stem.toLowerCase().startsWith(videoStem.toLowerCase())
    ? stem.slice(videoStem.length).replace(/^[ ._-]+/, '')
    : ''
  if (rest) {
    const code = rest.split(/[ ._-]/)[0]
    if (code.length >= 2 && code.length <= 8) return code.toUpperCase()
  }
  return 'Subtitles'
}
