// ─── Shared domain types ─────────────────────────────────────────────────────
// Compiled into main, preload, and renderer. Keep dependency-free.

export interface LibraryItem {
  /** sha1 of the absolute path — stable identity across renames of metadata */
  id: string
  path: string
  fileName: string
  /** Cleaned display title (release tags, dots, and extension stripped) */
  title: string
  folder: string
  ext: string
  sizeBytes: number
  mtimeMs: number
  addedAt: number
  /** Probed lazily by the renderer */
  durationSec?: number
  width?: number
  height?: number
  thumbReady?: boolean
  favorite: boolean
  pinned: boolean
  tags: string[]
  lastPlayedAt?: number
  positionSec?: number
  playCount: number
  /** Timeline bookmarks, seconds offsets, sorted ascending */
  bookmarks?: number[]
  /** Sidecar subtitle files discovered next to the video */
  subtitles: string[]
}

export interface LibraryState {
  revision: number
  folders: string[]
  items: LibraryItem[]
  /** True once default folders (Windows Videos) were offered — never re-seeded */
  seeded?: boolean
}

export interface ScanProgress {
  folder: string
  scanned: number
  found: number
  done: boolean
}

export type ThemeMode = 'system' | 'dark' | 'light' | 'oled'
export type WindowMaterial = 'mica' | 'acrylic' | 'solid'

export interface SubtitleStyle {
  fontFamily: string
  /** Percent of video height, e.g. 4.4 */
  sizePct: number
  color: string
  outline: boolean
  shadow: boolean
  /** 0..1 background plate opacity */
  bgOpacity: number
  /** Vertical position from bottom, percent of video height */
  bottomPct: number
  bold: boolean
}

export type HdrMode = 'auto' | 'vivid' | 'off'
export type ResolutionCap = 'auto' | 2160 | 1440 | 1080 | 720 | 480

export interface ColorAdjust {
  brightness: number
  contrast: number
  saturation: number
  gamma: number
}

export interface VideoSettings {
  cap: ResolutionCap
  hdr: HdrMode
  color: ColorAdjust
  /** User-located mpv.exe path (mpv engine, beta) */
  mpvPath?: string
  /** Route every file through mpv (for libraries that are mostly HEVC/10-bit/DTS) */
  preferMpv?: boolean
}

export interface MpvTrack {
  id: number
  label: string
  lang?: string
  selected: boolean
}
export interface MpvTracks {
  audio: MpvTrack[]
  sub: MpvTrack[]
}

export interface Settings {
  schema: 1
  theme: {
    mode: ThemeMode
    accent: string
    material: WindowMaterial
  }
  video: VideoSettings
  playback: {
    rememberPosition: boolean
    /** Position is discarded when within this many seconds of the end */
    resumeTailSec: number
    seekSmallSec: number
    seekLargeSec: number
    defaultRate: number
    autoPlay: boolean
    hardwareDecoding: boolean
  }
  audio: {
    volume: number
    muted: boolean
    /** 1 = off, up to 3 = +300% */
    boost: number
    normalize: boolean
    eq: number[] // 10 bands, dB -12..12
    eqEnabled: boolean
  }
  subtitles: {
    style: SubtitleStyle
    /** Global default delay applied to loaded tracks, ms */
    delayMs: number
    autoLoad: boolean
  }
  ui: {
    reducedMotion: boolean
    /** 0.9 .. 1.5 */
    scale: number
    sidebarCollapsed: boolean
    libraryView: 'grid' | 'list'
    librarySort: LibrarySort
    showExtensions: boolean
  }
  shortcuts: Record<string, string>
}

export type LibrarySort =
  | 'addedAt'
  | 'lastPlayedAt'
  | 'title'
  | 'durationSec'
  | 'resolution'
  | 'folder'
  | 'sizeBytes'

export interface Playlist {
  id: string
  name: string
  itemIds: string[]
  createdAt: number
  updatedAt: number
}

export interface OpenedFilePayload {
  path: string
}

/** Live event for a yt-dlp download job (main → renderer). */
export interface DownloadProgress {
  id: string
  url: string
  kind: 'progress' | 'status' | 'done' | 'error' | 'cancelled'
  percent?: number
  text?: string
  path?: string
  /** The library item registered for the finished file */
  item?: LibraryItem
}

/** Containers Chromium can demux directly. Codec support still varies by OS. */
export const HTML5_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'ogv'] as const

/** Common containers and elementary streams handled by the mpv sidecar. */
export const MPV_VIDEO_EXTENSIONS = [
  'mkv', 'avi', 'divx', 'wmv', 'asf', 'flv', 'f4v',
  'mpg', 'mpeg', 'mpe', 'm1v', 'm2v', 'vob',
  'ts', 'm2ts', 'mts', 'mxf', 'mod', 'tod',
  '3gp', '3g2', 'ogm', 'rm', 'rmvb', 'dv',
  'wtv', 'dvr-ms', 'amv', 'nsv', 'bik', 'smk',
  'h264', '264', 'h265', '265', 'hevc', 'ivf', 'y4m'
] as const

export const VIDEO_EXTENSIONS = [...HTML5_VIDEO_EXTENSIONS, ...MPV_VIDEO_EXTENSIONS] as const

export const SUBTITLE_EXTENSIONS = ['srt', 'vtt'] as const

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Segoe UI',
  sizePct: 4.4,
  color: '#ffffff',
  outline: true,
  shadow: true,
  bgOpacity: 0,
  bottomPct: 5,
  bold: false
}

export const DEFAULT_SETTINGS: Settings = {
  schema: 1,
  theme: { mode: 'system', accent: '#6c8cff', material: 'mica' },
  video: {
    cap: 'auto',
    hdr: 'auto',
    color: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
    preferMpv: false
  },
  playback: {
    rememberPosition: true,
    resumeTailSec: 90,
    seekSmallSec: 5,
    seekLargeSec: 10,
    defaultRate: 1,
    autoPlay: true,
    hardwareDecoding: true
  },
  audio: {
    volume: 1,
    muted: false,
    boost: 1,
    normalize: false,
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqEnabled: false
  },
  subtitles: {
    style: DEFAULT_SUBTITLE_STYLE,
    delayMs: 0,
    autoLoad: true
  },
  ui: {
    reducedMotion: false,
    scale: 1,
    sidebarCollapsed: false,
    libraryView: 'grid',
    librarySort: 'addedAt',
    showExtensions: false
  },
  shortcuts: {}
}

/** Deep-merge persisted settings over defaults so new fields never break old files */
export function mergeSettings(persisted: unknown): Settings {
  const merge = (base: any, over: any): any => {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base
    if (base !== null && typeof base === 'object') {
      const out: any = { ...base }
      if (over !== null && typeof over === 'object') {
        for (const k of Object.keys(base)) {
          if (k in over) out[k] = merge(base[k], over[k])
        }
        // shortcuts is an open map — carry user keys through
        if ('shortcuts' in base && over.shortcuts) out.shortcuts = { ...over.shortcuts }
      }
      return out
    }
    return typeof over === typeof base && over !== undefined ? over : base
  }
  return merge(DEFAULT_SETTINGS, persisted ?? {}) as Settings
}
