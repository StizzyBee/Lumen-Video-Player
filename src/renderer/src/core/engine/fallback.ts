// When the built-in Chromium engine fails on one of ITS OWN containers
// (mp4/mov/m4v/webm), the file almost always holds a codec Chromium can't
// decode without hardware help — HEVC/H.265, 10-bit H.264, or Dolby/DTS audio.
// mpv decodes all of these in software, so we hand off to it (or prompt to
// install it). Pure + unit-tested; the player store applies the result.
import { HTML5_CONTAINERS } from './select'

/** Failure kinds the HTML engine reports that mpv can typically rescue. */
const RECOVERABLE = new Set(['decode', 'unsupported', 'stall'])

export type FallbackAction =
  | 'mpv' // silently re-open the file in the mpv engine
  | 'needmpv' // mpv could play it but isn't installed — prompt to get it
  | 'none' // not a recoverable case; surface the original error

export function fallbackForHtmlFailure(
  ext: string,
  errorKind: string | null | undefined,
  mpvAvailable: boolean
): FallbackAction {
  const e = ext.toLowerCase().replace(/^\./, '')
  // Only rescue Chromium's own containers; other extensions are routed to mpv
  // up front by selectEngine and never reach the HTML engine.
  if (!HTML5_CONTAINERS.has(e)) return 'none'
  if (!errorKind || !RECOVERABLE.has(errorKind)) return 'none'
  return mpvAvailable ? 'mpv' : 'needmpv'
}
