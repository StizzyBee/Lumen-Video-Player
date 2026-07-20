import { create } from 'zustand'
import type { LibraryItem } from '@shared/types'
import { platform } from '@/core/platform'
import { HtmlVideoEngine } from '@/core/engine/HtmlVideoEngine'
import type { PlaybackEngine, PlaybackStatus, VideoFit } from '@/core/engine/types'
import { parseSubtitles, trackLabelFromPath, type SubtitleTrack } from '@/core/subtitles'
import { positionToSave } from '@/core/resume'
import { toggleBookmark } from '@/core/bookmarks'
import { selectEngine } from '@/core/engine/select'
import { fallbackForHtmlFailure } from '@/core/engine/fallback'
import { decideEndAction } from '@/core/playback-end'
import { isStreamItem, makeStreamItem, normalizeStreamUrl } from '@/core/streams'
import type { MpvTracks } from '@shared/types'
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
  /** True when the playing file carries HDR video (mpv sig-peak > 1); null = unknown */
  hdrContent: boolean | null

  attachHost(el: HTMLElement | null): void
  openItem(item: LibraryItem, opts?: { queue?: string[]; startOver?: boolean; forceMpv?: boolean }): void
  /** Re-open the current item in the mpv engine (manual override / auto-fallback) */
  playInMpv(): void
  openPaths(paths: string[]): Promise<void>
  /** Stream a remote URL (direct file → built-in engine; site page → mpv+yt-dlp) */
  openUrl(url: string): void
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
  /** Push settings.video (resolution cap, HDR, color) into the engine */
  applyVideoSettings(): void
  screenshot(): Promise<void>
  applyAudioSettings(): void
  engineQuality(): { dropped: number; total: number } | null
  // ── mpv engine (beta) ──
  mpvAvailable: boolean
  /** 'off' = built-in engine, 'playing' = mpv window active, 'needed' = mpv missing */
  mpvMode: 'off' | 'playing' | 'needed'
  /** True when mpv is rendering inside Lumen's window (vs its own window) */
  mpvEmbedded: boolean
  mpvTracks: MpvTracks
  /** True while a winget install of mpv is running */
  mpvInstalling: boolean
  /** Recent status lines from an in-progress install (shown to the user) */
  mpvInstallLog: string[]
  detectMpv(): Promise<void>
  locateMpv(): Promise<void>
  /** One-click install mpv via winget (falls back to the download page) */
  installMpv(): Promise<void>
  setMpvAudioTrack(id: number): void
  setMpvSubTrack(id: number | 'no'): void
}

let engine: PlaybackEngine | null = null
let host: HTMLElement | null = null
let unsubs: Array<() => void> = []
let persistTimer: number | null = null
let mpvSubscribed = false
// mpv reports width/height as separate observed properties; collect both
// before publishing dimensions. Whether mpv is paused (as opposed to stalled
// on cache) so buffering can resolve to the right status.
let mpvDims = { w: 0, h: 0 }
let mpvPausedProp = false

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
      if (item && !isStreamItem(item) && (!item.width || item.width !== dimensions.width)) {
        useLibrary.getState().patchItem(item.id, { width: dimensions.width, height: dimensions.height })
      }
    }),
    e.on('error', (errorKind) => {
      const s = get()
      const action = s.item ? fallbackForHtmlFailure(s.item.ext, errorKind, s.mpvAvailable) : 'none'
      if (action === 'mpv' && s.item) {
        useUi.getState().toast(
          { kind: 'info', title: 'Switching to the mpv engine', desc: "This file's codec needs mpv — handing off." },
          2600
        )
        // Defer so we don't tear down the engine from inside its own emit.
        const item = s.item
        const queue = s.queue
        window.setTimeout(() => {
          if (get().item?.id === item.id) get().openItem(item, { queue, forceMpv: true })
        }, 0)
        return
      }
      if (action === 'needmpv') {
        set({ status: 'error', errorKind: 'needmpv', mpvMode: 'needed' })
        return
      }
      set({ status: 'error', errorKind })
    }),
    e.on('pip', (pipActive) => set({ pipActive })),
    e.on('ended', () => runEndAction(get))
  )
  return e
}

function persistPosition(s: PlayerStore): void {
  const { item, time, duration } = s
  if (!item || isStreamItem(item)) return
  const { rememberPosition, resumeTailSec } = useSettings.getState().settings.playback
  if (!rememberPosition) return
  const pos = positionToSave(time, duration || item.durationSec, resumeTailSec)
  useLibrary.getState().patchItem(item.id, {
    positionSec: pos,
    lastPlayedAt: Date.now(),
    ...(duration ? { durationSec: Math.round(duration) } : {})
  })
}

/**
 * Handle end-of-video for whichever engine is active. Loop/autoplay logic is
 * shared (decideEndAction); only the restart mechanism differs by engine.
 */
function runEndAction(get: () => PlayerStore): void {
  const s = get()
  const action = decideEndAction({
    loop: s.loop,
    queueIndex: s.queueIndex,
    queueLength: s.queue.length,
    autoPlay: useSettings.getState().settings.playback.autoPlay
  })
  if (action === 'loop-one') {
    if (s.mpvMode === 'playing') {
      platform.mpv.seek(0)
      platform.mpv.playPause(false)
      usePlayer.setState({ status: 'playing', time: 0 })
    } else {
      engine?.seek(0)
      engine?.play()
    }
  } else if (action === 'next') {
    s.next()
  } else if (action === 'loop-all') {
    const first = useLibrary.getState().byId.get(s.queue[0])
    if (first) s.openItem(first, { queue: s.queue })
  } else if (s.mpvMode === 'playing') {
    usePlayer.setState({ status: 'ended' })
  }
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
  hdrContent: null,
  mpvAvailable: false,
  mpvMode: 'off',
  mpvEmbedded: false,
  mpvTracks: { audio: [], sub: [] },
  mpvInstalling: false,
  mpvInstallLog: [],

  setMpvAudioTrack(id) {
    platform.mpv.setAudioTrack(id)
    set((s) => ({ mpvTracks: { ...s.mpvTracks, audio: s.mpvTracks.audio.map((t) => ({ ...t, selected: t.id === id })) } }))
  },
  setMpvSubTrack(id) {
    platform.mpv.setSubTrack(id)
    set((s) => ({ mpvTracks: { ...s.mpvTracks, sub: s.mpvTracks.sub.map((t) => ({ ...t, selected: t.id === id })) } }))
  },

  async detectMpv() {
    const path = await platform.mpv.detect()
    set({ mpvAvailable: !!path })
    if (!mpvSubscribed) {
      mpvSubscribed = true
      platform.mpv.onEvent((e) => {
        const s = usePlayer.getState()
        if (s.mpvMode !== 'playing') return
        const failMpv = (): void => {
          if (persistTimer) window.clearInterval(persistTimer)
          persistTimer = null
          platform.app.setPlaying(false)
          set({ status: 'error', errorKind: 'mpv', mpvMode: 'off', mpvEmbedded: false })
        }
        if (e.type === 'exit') {
          failMpv()
        } else if (e.type === 'tracks') {
          set({ mpvTracks: (e.data as MpvTracks) ?? { audio: [], sub: [] } })
        } else if (e.type === 'prop') {
          if (e.name === 'time-pos' && typeof e.data === 'number') {
            const t = e.data
            // A-B repeat: jump back to A once we reach B
            if (s.ab.a !== null && s.ab.b !== null && t >= s.ab.b) {
              platform.mpv.seek(s.ab.a)
              set({ time: s.ab.a })
            } else set({ time: t })
          } else if (e.name === 'duration' && typeof e.data === 'number') set({ duration: e.data })
          else if (e.name === 'pause') {
            mpvPausedProp = !!e.data
            set({ status: e.data ? 'paused' : 'playing' })
          } else if (e.name === 'width' || e.name === 'height') {
            if (typeof e.data === 'number' && e.data > 0) {
              if (e.name === 'width') mpvDims.w = e.data
              else mpvDims.h = e.data
              if (mpvDims.w && mpvDims.h) {
                set({ dimensions: { width: mpvDims.w, height: mpvDims.h } })
                const item = s.item
                if (item && !isStreamItem(item) && (item.width !== mpvDims.w || item.height !== mpvDims.h)) {
                  useLibrary.getState().patchItem(item.id, { width: mpvDims.w, height: mpvDims.h })
                }
              }
            }
          } else if (e.name === 'video-params/sig-peak') {
            // The real HDR signal: sig-peak > 1 means the video carries HDR
            if (typeof e.data === 'number') set({ hdrContent: e.data > 1 })
          } else if (e.name === 'paused-for-cache') {
            if (e.data) set({ status: 'buffering' })
            else if (s.status === 'buffering') set({ status: mpvPausedProp ? 'paused' : 'playing' })
          } else if (e.name === 'eof-reached' && e.data) runEndAction(get)
        } else if (e.type === 'ready') {
          set({ status: 'playing' })
          // Launch args cover the initial grade; re-assert so mid-session
          // settings edits and per-file tweaks always match the UI state.
          s.applyVideoSettings()
          s.applyAudioSettings()
        } else if (e.type === 'error') {
          failMpv()
        }
      })
    }
  },

  async locateMpv() {
    const path = await platform.mpv.locate()
    set({ mpvAvailable: !!path })
    if (path) {
      useUi.getState().toast({
        kind: 'ok',
        title: 'mpv engine ready',
        desc: 'MKV, M2TS/MTS, VOB, MXF, HEVC, HDR and other advanced formats will use mpv.'
      })
      // retry the current file if we were blocked on it
      const s = get()
      if (s.mpvMode === 'needed' && s.item) s.openItem(s.item, { queue: s.queue })
    }
  },

  async installMpv() {
    if (get().mpvInstalling) return
    // No winget → we can't install for them; send them to the official page.
    const hasWinget = await platform.mpv.hasWinget()
    if (!hasWinget) {
      useUi.getState().toast(
        { kind: 'warn', title: 'Automatic install needs Windows Package Manager', desc: 'Opening mpv.io so you can install it manually.' },
        4500
      )
      window.open('https://mpv.io/installation/', '_blank')
      return
    }
    set({ mpvInstalling: true, mpvInstallLog: ['Starting Windows Package Manager…'] })
    const unsub = platform.mpv.onInstallProgress((line) => {
      set((s) => ({ mpvInstallLog: [...s.mpvInstallLog, line].slice(-5) }))
    })
    try {
      const res = await platform.mpv.install()
      unsub()
      set({ mpvInstalling: false, mpvInstallLog: [] })
      if (res.ok) {
        await get().detectMpv()
        useUi.getState().toast({ kind: 'ok', title: 'mpv installed', desc: 'Playing your file now.' }, 3500)
        const s = get()
        if (s.item && (s.mpvMode === 'needed' || s.status === 'error')) get().playInMpv()
      } else {
        useUi.getState().toast(
          { kind: 'warn', title: "Couldn't install mpv automatically", desc: 'Install it from mpv.io, then use “Locate existing mpv”.' },
          5000
        )
      }
    } catch {
      unsub()
      set({ mpvInstalling: false })
      useUi.getState().toast({ kind: 'warn', title: 'mpv install failed', desc: 'Try installing it manually from mpv.io.' }, 5000)
    }
  },

  attachHost(el) {
    host = el
    if (el && engine) {
      engine.attach(el)
    }
  },

  openItem(item, opts) {
    const settings = useSettings.getState().settings
    const queue = opts?.queue ?? get().queue
    const queueIndex = queue.indexOf(item.id)

    const startAt =
      !opts?.startOver && settings.playback.rememberPosition && item.positionSec ? item.positionSec : 0

    // Route MKV/AVI/HEVC-in-mkv etc. to the mpv engine when the built-in
    // Chromium engine can't handle the container — or when the user prefers
    // mpv / we're falling back after a decode failure.
    const preferMpv = !!settings.video.preferMpv || !!opts?.forceMpv
    const choice = selectEngine(item.ext, { mpvAvailable: get().mpvAvailable, preferMpv })
    if (choice !== 'html5') {
      // tear down any html5 engine first
      if (engine) {
        for (const u of unsubs) u()
        unsubs = []
        engine.destroy()
        engine = null
      }
      mpvDims = { w: 0, h: 0 }
      mpvPausedProp = false
      set({
        item,
        queue,
        queueIndex,
        time: startAt,
        duration: item.durationSec ?? 0,
        buffered: [],
        subTracks: [],
        activeSubId: null,
        ab: { a: null, b: null },
        pipActive: false,
        hdrContent: null,
        dimensions: item.width && item.height ? { width: item.width, height: item.height } : null,
        status: choice === 'mpv' ? 'loading' : 'error',
        errorKind: choice === 'mpv' ? null : 'needmpv',
        mpvMode: choice === 'mpv' ? 'playing' : 'needed',
        mpvEmbedded: false,
        mpvTracks: { audio: [], sub: [] }
      })
      useUi.getState().navigate({ name: 'player' })
      if (choice === 'mpv') {
        void platform.mpv
          .play(item.path, {
            hdr: settings.video.hdr,
            color: settings.video.color,
            hwdec: settings.playback.hardwareDecoding,
            volume: settings.audio.muted ? 0 : settings.audio.volume,
            startAt,
            embed: true
          })
          .then((res) => set({ mpvEmbedded: !!res?.embedded }))
          .catch(() => {
            platform.app.setPlaying(false)
            set({ status: 'error', errorKind: 'mpv', mpvMode: 'off', mpvEmbedded: false })
          })
        platform.app.setPlaying(true)
        if (!isStreamItem(item)) {
          useLibrary.getState().patchItem(item.id, { lastPlayedAt: Date.now(), playCount: item.playCount + 1 })
        }
        // periodic resume-position save (time/duration are mirrored from mpv)
        if (persistTimer) window.clearInterval(persistTimer)
        persistTimer = window.setInterval(() => {
          if (get().status === 'playing') persistPosition(get())
        }, 5000)
      }
      return
    }

    const e = ensureEngine(get, set)
    set({
      mpvMode: 'off',
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
      pipActive: false,
      hdrContent: null
    })
    useUi.getState().navigate({ name: 'player' })

    // Streams play their URL directly; local files go through lumen://
    const src = isStreamItem(item) ? item.path : platform.media.url(item.path)
    void e.load(src, { startAt, autoplay: true })
    e.setRate(settings.playback.defaultRate)
    get().applyAudioSettings()
    get().applyVideoSettings()

    if (!isStreamItem(item)) {
      useLibrary.getState().patchItem(item.id, {
        lastPlayedAt: Date.now(),
        playCount: item.playCount + 1
      })
    }

    if (settings.subtitles.autoLoad) {
      for (const sub of item.subtitles.slice(0, 6)) void get().addSubtitleFromPath(sub)
    }

    if (persistTimer) window.clearInterval(persistTimer)
    persistTimer = window.setInterval(() => {
      if (get().status === 'playing') persistPosition(get())
    }, 5000)
  },

  playInMpv() {
    const s = get()
    if (!s.item) return
    if (s.mpvMode === 'playing') return // already in mpv
    if (!s.mpvAvailable) {
      set({ status: 'error', errorKind: 'needmpv', mpvMode: 'needed' })
      return
    }
    get().openItem(s.item, { queue: s.queue, forceMpv: true })
  },

  async openPaths(paths) {
    const items = await platform.library.addPaths(paths)
    if (items.length === 0) {
      useUi.getState().toast({ kind: 'warn', title: 'No playable videos found' })
      return
    }
    get().openItem(items[0], { queue: items.map((i) => i.id) })
  },

  openUrl(url) {
    const normalized = normalizeStreamUrl(url)
    if (!normalized) {
      useUi.getState().toast({ kind: 'warn', title: "That doesn't look like a video URL", desc: 'Paste an http(s) link to a video file or page.' })
      return
    }
    get().openItem(makeStreamItem(normalized), { queue: [] })
  },

  close() {
    persistPosition(get())
    if (get().mpvMode === 'playing') platform.mpv.stop()
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
      pipActive: false,
      hdrContent: null,
      mpvMode: 'off',
      mpvEmbedded: false
    })
    useUi.getState().closePlayerView()
  },

  togglePlay() {
    const s = get()
    if (s.mpvMode === 'playing') {
      const paused = s.status === 'playing'
      platform.mpv.playPause(paused)
      set({ status: paused ? 'paused' : 'playing' })
      return
    }
    if (!engine) return
    if (s.status === 'playing') engine.pause()
    else if (s.status === 'ended') {
      engine.seek(0)
      engine.play()
    } else engine.play()
  },
  play() {
    if (get().mpvMode === 'playing') return platform.mpv.playPause(false)
    engine?.play()
  },
  pause() {
    if (get().mpvMode === 'playing') return platform.mpv.playPause(true)
    engine?.pause()
  },
  seekTo(sec) {
    if (get().mpvMode === 'playing') {
      platform.mpv.seek(sec)
      set({ time: sec })
      return
    }
    engine?.seek(sec)
    set({ time: Math.max(0, Math.min(sec, get().duration || sec)) })
  },
  seekBy(sec) {
    const s = get()
    get().seekTo(s.time + sec)
  },
  setRate(r) {
    if (get().mpvMode === 'playing') {
      platform.mpv.setRate(r)
      set({ rate: r })
      return
    }
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
    if (get().mpvMode === 'playing') return platform.mpv.frameStep(dir)
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
    if (isStreamItem(item)) {
      useUi.getState().toast({ kind: 'info', title: 'Bookmarks need a library file', desc: 'Download the video to bookmark moments in it.' }, 2500)
      return
    }
    const live = useLibrary.getState().byId.get(item.id)
    const { list, added } = toggleBookmark(live?.bookmarks, time)
    useLibrary.getState().patchItem(item.id, { bookmarks: list })
    useUi.getState().toast(
      { kind: added ? 'ok' : 'info', title: added ? 'Bookmark added' : 'Bookmark removed' },
      1500
    )
  },

  async screenshot() {
    const item = get().item
    if (!item) return
    const t = Math.floor(get().time)
    const stamp = `${String(Math.floor(t / 60)).padStart(2, '0')}-${String(t % 60).padStart(2, '0')}`
    const name = `${item.title.replace(/[<>:"/\\|?*]+/g, '')} — ${stamp}.png`

    // mpv renders in its own GPU window, so capture through mpv itself.
    if (get().mpvMode === 'playing') {
      const saved = await platform.mpv.screenshot(name)
      if (saved) useUi.getState().toast({ kind: 'ok', title: 'Screenshot saved', desc: saved })
      return
    }

    const e = engine
    if (!e) return
    const dataUrl = await e.captureFrame()
    if (!dataUrl) {
      useUi.getState().toast({ kind: 'warn', title: 'Could not capture frame' })
      return
    }
    const saved = await platform.shell.saveScreenshot(dataUrl, name)
    if (saved) {
      useUi.getState().toast({ kind: 'ok', title: 'Screenshot saved', desc: saved })
    }
  },

  applyAudioSettings() {
    const a = useSettings.getState().settings.audio
    if (get().mpvMode === 'playing') {
      // mpv has its own volume/mute; boost/EQ/normalize are WebAudio-only
      platform.mpv.setVolume(a.volume)
      platform.mpv.setMuted(a.muted)
      return
    }
    if (!engine) return
    engine.setVolume(a.volume)
    engine.setMuted(a.muted)
    engine.setBoost(a.boost)
    engine.setNormalize(a.normalize)
    engine.setEq(a.eq, a.eqEnabled)
  },

  applyVideoSettings() {
    const v = useSettings.getState().settings.video
    if (get().mpvMode === 'playing') {
      // HDR mode + color grade apply live over mpv IPC; the resolution cap is
      // a html5-engine downscale — mpv always renders at source quality.
      platform.mpv.setGrade(v.color, v.hdr)
      return
    }
    if (!engine) return
    engine.setResolutionCap(v.cap)
    engine.setVideoGrade(v.color, v.hdr)
  },

  engineQuality() {
    return engine && engine instanceof HtmlVideoEngine ? engine.quality() : null
  }
}))
