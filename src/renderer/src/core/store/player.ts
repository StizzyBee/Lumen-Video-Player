import { create } from 'zustand'
import type { LibraryItem } from '@shared/types'
import { platform } from '@/core/platform'
import { HtmlVideoEngine } from '@/core/engine/HtmlVideoEngine'
import type { PlaybackEngine, PlaybackStatus, VideoFit } from '@/core/engine/types'
import { parseSubtitles, trackLabelFromPath, type SubtitleTrack } from '@/core/subtitles'
import { positionToSave } from '@/core/resume'
import { toggleBookmark } from '@/core/bookmarks'
import { useSettings } from './settings'
import { useLibrary } from './library'
import { useUi } from './ui'

export type LoopMode = 'off' | 'one' | 'all'

interface PlayerStore {
  item: LibraryItem | null
  queue: string[]
  queueIndex: number
  status: PlaybackStatus
  time: number
  duration: number
  buffered: Array<[number, number]>
  rate: number
  dimensions: { width: number; height: number } | null
  errorKind: string | null
  subTracks: SubtitleTrack[]
  activeSubId: string | null
  subDelayMs: number
  loop: LoopMode
  ab: { a: number | null; b: number | null }
  statsVisible: boolean
  pipActive: boolean
  fit: VideoFit

  attachHost(el: HTMLElement | null): void
  openItem(item: LibraryItem, opts?: { queue?: string[]; startOver?: boolean }): void
  openPaths(paths: string[]): Promise<void>
  close(): void
  togglePlay(): void
  play(): void
  pause(): void
  seekTo(sec: number): void
  seekBy(sec: number): void
  setRate(r: number): void
  cycleLoop(): void
  setAbPoint(): void
  clearAb(): void
  frameStep(dir: 1 | -1): void
  next(): void
  previous(): void
  addSubtitleFromPath(path: string): Promise<void>
  addSubtitleFromText(label: string, text: string): void
  setActiveSub(id: string | null): void
  nudgeSubDelay(deltaMs: number): void
  toggleStats(): void
  togglePip(): void
  setFit(fit: VideoFit): void
  toggleBookmarkHere(): void
  screenshot(): Promise<void>
  applyAudioSettings(): void
  engineQuality(): { dropped: number; total: number } | null
}

let engine: PlaybackEngine | null = null
let host: HTMLElement | null = null
let unsubs: Array<() => void> = []
let persistTimer: number | null = null

function ensureEngine(get: () => PlayerStore, set: (p: Partial<PlayerStore>) => void): PlaybackEngine {
  if (engine) return engine
  const e = new HtmlVideoEngine()
  engine = e
  if (host) e.attach(host)

  unsubs.push(
    e.on('time', (t) => {
      const s = get()
      // A-B repeat
      if (s.ab.a !== null && s.ab.b !== null && t >= s.ab.b) {
        e.seek(s.ab.a)
        return
      }
      set({ time: t })
    }),
    e.on('duration', (d) => set({ duration: d })),
    e.on('status', (status) => {
      set({ status })
      platform.app.setPlaying(status === 'playing')
      if (status === 'paused' || status === 'ended') persistPosition(get())
    }),
    e.on('buffered', (buffered) => set({ buffered })),
    e.on('rate', (rate) => set({ rate })),
    e.on('dimensions', (dimensions) => {
      set({ dimensions })
      const item = get().item
      if (item && (!item.width || item.width !== dimensions.width)) {
        useLibrary.getState().patchItem(item.id, { width: dimensions.width, height: dimensions.height })
      }
    }),
    e.on('error', (errorKind) => set({ errorKind })),
    e.on('pip', (pipActive) => set({ pipActive })),
    e.on('ended', () => {
      const s = get()
      if (s.loop === 'one') {
        e.seek(0)
        e.play()
        return
      }
      const auto = useSettings.getState().settings.playback.autoPlay
      const hasNext = s.queueIndex < s.queue.length - 1
      if (auto && hasNext) s.next()
      else if (auto && s.loop === 'all' && s.queue.length > 0) {
        const first = useLibrary.getState().byId.get(s.queue[0])
        if (first) s.openItem(first, { queue: s.queue })
      }
    })
  )
  return e
}

function persistPosition(s: PlayerStore): void {
  const { item, time, duration } = s
  if (!item) return
  const { rememberPosition, resumeTailSec } = useSettings.getState().settings.playback
  if (!rememberPosition) return
  const pos = positionToSave(time, duration || item.durationSec, resumeTailSec)
  useLibrary.getState().patchItem(item.id, {
    positionSec: pos,
    lastPlayedAt: Date.now(),
    ...(duration ? { durationSec: Math.round(duration) } : {})
  })
}

export const usePlayer = create<PlayerStore>((set, get) => ({
  item: null,
  queue: [],
  queueIndex: -1,
  status: 'idle',
  time: 0,
  duration: 0,
  buffered: [],
  rate: 1,
  dimensions: null,
  errorKind: null,
  subTracks: [],
  activeSubId: null,
  subDelayMs: 0,
  loop: 'off',
  ab: { a: null, b: null },
  statsVisible: false,
  pipActive: false,
  fit: 'contain',

  attachHost(el) {
    host = el
    if (el && engine) {
      engine.attach(el)
    }
  },

  openItem(item, opts) {
    const settings = useSettings.getState().settings
    const e = ensureEngine(get, set)
    const queue = opts?.queue ?? get().queue
    const queueIndex = queue.indexOf(item.id)

    const startAt =
      !opts?.startOver && settings.playback.rememberPosition && item.positionSec ? item.positionSec : 0

    set({
      item,
      queue,
      queueIndex,
      status: 'loading',
      time: startAt,
      duration: item.durationSec ?? 0,
      buffered: [],
      errorKind: null,
      dimensions: item.width && item.height ? { width: item.width, height: item.height } : null,
      subTracks: [],
      activeSubId: null,
      subDelayMs: settings.subtitles.delayMs,
      ab: { a: null, b: null },
      pipActive: false
    })
    useUi.getState().navigate({ name: 'player' })

    void e.load(platform.media.url(item.path), { startAt, autoplay: true })
    e.setRate(settings.playback.defaultRate)
    get().applyAudioSettings()

    useLibrary.getState().patchItem(item.id, {
      lastPlayedAt: Date.now(),
      playCount: item.playCount + 1
    })

    if (settings.subtitles.autoLoad) {
      for (const sub of item.subtitles.slice(0, 6)) void get().addSubtitleFromPath(sub)
    }

    if (persistTimer) window.clearInterval(persistTimer)
    persistTimer = window.setInterval(() => {
      if (get().status === 'playing') persistPosition(get())
    }, 5000)
  },

  async openPaths(paths) {
    const items = await platform.library.addPaths(paths)
    if (items.length === 0) {
      useUi.getState().toast({ kind: 'warn', title: 'No playable videos found' })
      return
    }
    get().openItem(items[0], { queue: items.map((i) => i.id) })
  },

  close() {
    persistPosition(get())
    if (persistTimer) window.clearInterval(persistTimer)
    persistTimer = null
    for (const u of unsubs) u()
    unsubs = []
    engine?.destroy()
    engine = null
    platform.app.setPlaying(false)
    set({
      item: null,
      status: 'idle',
      time: 0,
      duration: 0,
      buffered: [],
      subTracks: [],
      activeSubId: null,
      dimensions: null,
      errorKind: null,
      ab: { a: null, b: null },
      pipActive: false
    })
    useUi.getState().closePlayerView()
  },

  togglePlay() {
    const s = get()
    if (!engine) return
    if (s.status === 'playing') engine.pause()
    else if (s.status === 'ended') {
      engine.seek(0)
      engine.play()
    } else engine.play()
  },
  play() {
    engine?.play()
  },
  pause() {
    engine?.pause()
  },
  seekTo(sec) {
    engine?.seek(sec)
    set({ time: Math.max(0, Math.min(sec, get().duration || sec)) })
  },
  seekBy(sec) {
    const s = get()
    get().seekTo(s.time + sec)
  },
  setRate(r) {
    engine?.setRate(r)
    set({ rate: r })
  },
  cycleLoop() {
    const order: LoopMode[] = ['off', 'all', 'one']
    const next = order[(order.indexOf(get().loop) + 1) % order.length]
    set({ loop: next })
    useUi.getState().toast({
      kind: 'info',
      title: next === 'off' ? 'Loop off' : next === 'one' ? 'Looping this video' : 'Looping queue'
    }, 1800)
  },
  setAbPoint() {
    const { ab, time } = get()
    if (ab.a === null) {
      set({ ab: { a: time, b: null } })
      useUi.getState().toast({ kind: 'info', title: 'A point set' }, 1500)
    } else if (ab.b === null) {
      if (time > ab.a + 0.5) {
        set({ ab: { a: ab.a, b: time } })
        useUi.getState().toast({ kind: 'info', title: 'A–B repeat on' }, 1500)
      }
    } else {
      set({ ab: { a: null, b: null } })
      useUi.getState().toast({ kind: 'info', title: 'A–B repeat off' }, 1500)
    }
  },
  clearAb() {
    set({ ab: { a: null, b: null } })
  },
  frameStep(dir) {
    engine?.frameStep(dir)
  },

  next() {
    const s = get()
    if (s.queueIndex < s.queue.length - 1) {
      const item = useLibrary.getState().byId.get(s.queue[s.queueIndex + 1])
      if (item) get().openItem(item, { queue: s.queue })
    }
  },
  previous() {
    const s = get()
    // Standard behavior: restart if we're past 3s, else go to previous
    if (s.time > 3 || s.queueIndex <= 0) {
      get().seekTo(0)
      return
    }
    const item = useLibrary.getState().byId.get(s.queue[s.queueIndex - 1])
    if (item) get().openItem(item, { queue: s.queue })
  },

  async addSubtitleFromPath(path) {
    try {
      const text = await platform.media.readText(path)
      const cues = parseSubtitles(text)
      if (!cues.length) return
      const stem = get().item?.fileName.replace(/\.[^.]+$/, '')
      const track: SubtitleTrack = { id: path, label: trackLabelFromPath(path, stem), path, cues }
      set((s) => {
        if (s.subTracks.some((t) => t.id === path)) return s
        return {
          subTracks: [...s.subTracks, track],
          activeSubId: s.activeSubId ?? path
        }
      })
    } catch {
      useUi.getState().toast({ kind: 'warn', title: 'Could not load subtitles' })
    }
  },

  addSubtitleFromText(label, text) {
    const cues = parseSubtitles(text)
    if (!cues.length) {
      useUi.getState().toast({ kind: 'warn', title: 'No cues found in subtitle file' })
      return
    }
    const id = `inline:${label}:${Date.now()}`
    set((s) => ({
      subTracks: [...s.subTracks, { id, label, cues }],
      activeSubId: id
    }))
  },

  setActiveSub(id) {
    set({ activeSubId: id })
  },
  nudgeSubDelay(deltaMs) {
    const next = get().subDelayMs + deltaMs
    set({ subDelayMs: next })
    useUi.getState().toast(
      { kind: 'info', title: `Subtitle delay ${next > 0 ? '+' : ''}${(next / 1000).toFixed(2)}s` },
      1200
    )
  },
  toggleStats() {
    set((s) => ({ statsVisible: !s.statsVisible }))
  },
  togglePip() {
    void engine?.requestPip().catch(() => {
      useUi.getState().toast({ kind: 'warn', title: 'Picture-in-picture unavailable' })
    })
  },
  setFit(fit) {
    engine?.setFit(fit)
    set({ fit })
  },

  toggleBookmarkHere() {
    const { item, time } = get()
    if (!item) return
    const live = useLibrary.getState().byId.get(item.id)
    const { list, added } = toggleBookmark(live?.bookmarks, time)
    useLibrary.getState().patchItem(item.id, { bookmarks: list })
    useUi.getState().toast(
      { kind: added ? 'ok' : 'info', title: added ? 'Bookmark added' : 'Bookmark removed' },
      1500
    )
  },

  async screenshot() {
    const e = engine
    const item = get().item
    if (!e || !item) return
    const dataUrl = await e.captureFrame()
    if (!dataUrl) {
      useUi.getState().toast({ kind: 'warn', title: 'Could not capture frame' })
      return
    }
    const t = Math.floor(get().time)
    const name = `${item.title.replace(/[<>:"/\\|?*]+/g, '')} — ${String(Math.floor(t / 60)).padStart(2, '0')}-${String(t % 60).padStart(2, '0')}.png`
    const saved = await platform.shell.saveScreenshot(dataUrl, name)
    if (saved) {
      useUi.getState().toast({ kind: 'ok', title: 'Screenshot saved', desc: saved })
    }
  },

  applyAudioSettings() {
    const a = useSettings.getState().settings.audio
    if (!engine) return
    engine.setVolume(a.volume)
    engine.setMuted(a.muted)
    engine.setBoost(a.boost)
    engine.setNormalize(a.normalize)
    engine.setEq(a.eq, a.eqEnabled)
  },

  engineQuality() {
    return engine && engine instanceof HtmlVideoEngine ? engine.quality() : null
  }
}))
