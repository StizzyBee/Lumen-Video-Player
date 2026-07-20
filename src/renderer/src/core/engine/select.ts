// Pure engine-selection: which playback engine handles a given file.
// Unit-tested; used by the player store to pick html5 vs mpv (vs none).
import { HTML5_VIDEO_EXTENSIONS } from '@shared/types'

export type EngineId = 'html5' | 'mpv'
export type EngineChoice = EngineId | 'none'

/** Containers Chromium can demux (codecs still vary; HEVC/H.264/VP9/AV1). */
export const HTML5_CONTAINERS = new Set<string>(HTML5_VIDEO_EXTENSIONS)

export interface SelectOpts {
  mpvAvailable: boolean
  /** User forces mpv for everything (e.g. wants its color/HDR handling) */
  preferMpv?: boolean
}

/**
 * Decide the engine for a file extension.
 * - mpv when the user prefers it and it's ready (handles everything)
 * - html5 for its native containers
 * - otherwise mpv when available; 'none' if only mpv could play it but it isn't
 */
export function selectEngine(ext: string, opts: SelectOpts): EngineChoice {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (opts.preferMpv && opts.mpvAvailable) return 'mpv'
  if (HTML5_CONTAINERS.has(e)) return 'html5'
  return opts.mpvAvailable ? 'mpv' : 'none'
}

/** Human list of formats that need mpv, for messaging. */
export const MPV_ONLY_EXAMPLES = 'MKV, M2TS/MTS, VOB, MXF, AVI, WMV, FLV and more'
