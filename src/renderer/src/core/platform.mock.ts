// Browser mock of the Lumen platform API. Lets the full UI run in a plain
// browser tab with demo content and localStorage persistence — used for UI
// development, visual review, and as the plugin-facing reference implementation.
import type { LumenApi } from '@shared/lumen-api'
import {
  mergeSettings,
  type LibraryItem,
  type LibraryState,
  type Playlist,
  type Settings
} from '@shared/types'

const LS_SETTINGS = 'lumen.mock.settings'
const LS_LIBRARY = 'lumen.mock.library'
const LS_PLAYLISTS = 'lumen.mock.playlists'

// Public sample videos (Google CDN) so playback is fully exercisable in-browser.
const SAMPLES: Array<{ name: string; url: string; dur: number; folder: string; tags?: string[] }> = [
  { name: 'Big Buck Bunny (2008) 1080p.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', dur: 596, folder: 'D:\\Videos\\Movies' },
  { name: 'Elephants Dream (2006) 1080p.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', dur: 653, folder: 'D:\\Videos\\Movies' },
  { name: 'Sintel.2010.4K.HDR.x265.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', dur: 888, folder: 'D:\\Videos\\Movies' },
  { name: 'Tears of Steel S01E01 2160p.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', dur: 734, folder: 'D:\\Videos\\Shows\\Tears of Steel' },
  { name: 'Subaru.Outback.Review.720p.WEB-DL.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4', dur: 594, folder: 'D:\\Videos\\Clips' },
  { name: 'For Bigger Blazes.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', dur: 15, folder: 'D:\\Videos\\Clips' },
  { name: 'For Bigger Escapes.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', dur: 15, folder: 'D:\\Videos\\Clips' },
  { name: 'For Bigger Fun.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', dur: 60, folder: 'D:\\Videos\\Clips' },
  { name: 'For Bigger Joyrides.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', dur: 15, folder: 'D:\\Videos\\Clips' },
  { name: 'For Bigger Meltdowns.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', dur: 15, folder: 'D:\\Videos\\Clips' },
  { name: 'Volkswagen.GTI.Review.1080p.WEBRip.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4', dur: 594, folder: 'D:\\Videos\\Clips' },
  { name: 'We Are Going On Bullrun S02E04.mp4', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4', dur: 47, folder: 'D:\\Videos\\Shows\\Bullrun' }
]

function cleanName(n: string): string {
  return n
    .replace(/\.[^.]+$/, '')
    .replace(/\./g, ' ')
    .replace(/\b(1080p|720p|2160p|4k|hdr|x265|x264|web-?dl|webrip)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 24)
}

function seedLibrary(): LibraryState {
  const now = Date.now()
  const items: LibraryItem[] = SAMPLES.map((s, i) => ({
    id: hash(s.url),
    path: `${s.folder}\\${s.name}`,
    fileName: s.name,
    title: cleanName(s.name),
    folder: s.folder,
    ext: 'mp4',
    sizeBytes: 150_000_000 + i * 37_000_000,
    mtimeMs: now - i * 86_400_000,
    addedAt: now - i * 86_400_000,
    durationSec: s.dur,
    width: 1920,
    height: 1080,
    favorite: i % 5 === 1,
    pinned: i % 7 === 2,
    tags: s.tags ?? [],
    lastPlayedAt: i < 4 ? now - i * 3_600_000 : undefined,
    positionSec: i < 4 ? s.dur * (0.18 + i * 0.2) : undefined,
    playCount: i < 4 ? 1 + (i % 3) : 0,
    subtitles: []
  }))
  return {
    revision: 1,
    folders: ['D:\\Videos\\Movies', 'D:\\Videos\\Shows', 'D:\\Videos\\Clips'],
    items
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full/unavailable — mock persistence is best-effort
  }
}

export function createMockLumen(): LumenApi {
  let library = load<LibraryState>(LS_LIBRARY, seedLibrary())
  let settings = mergeSettings(load<Partial<Settings> | null>(LS_SETTINGS, null))
  let playlists = load<Playlist[]>(LS_PLAYLISTS, [])
  const urlById = new Map(SAMPLES.map((s) => [hash(s.url), s.url]))

  const libListeners = new Set<(s: LibraryState) => void>()
  const setListeners = new Set<(s: Settings) => void>()

  const emitLibrary = (): void => {
    save(LS_LIBRARY, library)
    for (const cb of libListeners) cb(library)
  }

  const api: LumenApi = {
    win: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      setFullscreen: (on) => {
        if (on) void document.documentElement.requestFullscreen?.().catch(() => {})
        else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      },
      isMaximized: async () => false,
      setMiniMode: () => {},
      setZoomFactor: () => {},
      onMaximized: () => () => {},
      onFullscreen: (cb) => {
        const h = (): void => cb(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', h)
        return () => document.removeEventListener('fullscreenchange', h)
      }
    },
    library: {
      getState: async () => library,
      addFolder: async () => {
        // Browser demo: simulate a scan finding the seed content again
        return library
      },
      removeFolder: async (folder) => {
        library = {
          ...library,
          folders: library.folders.filter((f) => f !== folder),
          items: library.items.filter((i) => !i.folder.toLowerCase().startsWith(folder.toLowerCase()))
        }
        emitLibrary()
        return library
      },
      rescan: async () => {},
      updateItem: async (id, patch) => {
        library = {
          ...library,
          items: library.items.map((i) => (i.id === id ? { ...i, ...patch, id: i.id, path: i.path } : i))
        }
        emitLibrary()
      },
      addPaths: async () => [],
      openFileDialog: async () => null,
      onChanged: (cb) => {
        libListeners.add(cb)
        return () => libListeners.delete(cb)
      },
      onScanProgress: () => () => {}
    },
    media: {
      url: (path) => {
        const item = library.items.find((i) => i.path === path)
        return (item && urlById.get(item.id)) ?? path
      },
      readText: async () => '',
      pathForFile: () => ''
    },
    thumbs: {
      save: async (id) => {
        library = {
          ...library,
          items: library.items.map((i) => (i.id === id ? { ...i, thumbReady: true } : i))
        }
        emitLibrary()
      },
      // In-browser we can't persist JPEGs; thumbnails are generated live into a
      // memory cache by the thumbnail queue (see core/thumbs.ts)
      url: (id) => memThumbs.get(id) ?? ''
    },
    settings: {
      get: async () => settings,
      patch: async (patch) => {
        settings = mergeSettings(deepMerge(settings, patch))
        save(LS_SETTINGS, settings)
        for (const cb of setListeners) cb(settings)
        return settings
      },
      onChanged: (cb) => {
        setListeners.add(cb)
        return () => setListeners.delete(cb)
      }
    },
    playlists: {
      list: async () => playlists,
      save: async (p) => {
        const idx = playlists.findIndex((x) => x.id === p.id)
        if (idx >= 0) playlists[idx] = p
        else playlists.push(p)
        save(LS_PLAYLISTS, playlists)
      },
      remove: async (id) => {
        playlists = playlists.filter((x) => x.id !== id)
        save(LS_PLAYLISTS, playlists)
      }
    },
    mpv: {
      detect: async () => null,
      locate: async () => null,
      hasWinget: async () => false,
      install: async () => ({ ok: false, reason: 'no-winget' }),
      onInstallProgress: () => () => {},
      play: async () => ({ embedded: false }),
      setSurfaceRect: () => {},
      playPause: () => {},
      seek: () => {},
      setRate: () => {},
      setVolume: () => {},
      setMuted: () => {},
      setAudioTrack: () => {},
      setSubTrack: () => {},
      frameStep: () => {},
      screenshot: async () => null,
      stop: () => {},
      onEvent: () => () => {}
    },
    shell: {
      showInFolder: () => {},
      saveScreenshot: async (dataUrl, name) => {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = name
        a.click()
        return name
      }
    },
    app: {
      version: async () => '0.1.0-web',
      platform: 'browser',
      getOpenedFile: async () => null,
      onOpenFile: () => () => {},
      setPlaying: () => {}
    }
  }
  return api
}

/** Session-scoped thumbnail data-URL cache for the browser mock */
export const memThumbs = new Map<string, string>()

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : (patch as T))
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)?.[k], v)
  }
  return out as T
}
