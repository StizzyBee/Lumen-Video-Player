// Pure engine-selection: which playback engine handles a given file.
// Unit-tested; used by the player store to pick html5 vs mpv (vs none).

export type EngineId = 'html5' | 'mpv'
export type EngineChoice = EngineId | 'none'

/** Containers Chromium can demux (codecs still vary; HEVC/H.264/VP9/AV1). */
export const HTML5_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv'])

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
export const MPV_ONLY_EXAMPLES = 'MKV, AVI, WMV, FLV, MPEG, TS'
