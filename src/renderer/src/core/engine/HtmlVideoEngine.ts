import type { EngineCaps, EngineEvents, PlaybackEngine, PlaybackStatus, VideoFit } from './types'
import { setVideoSource } from '@/core/media'
import { planRender, buildFilter } from '@/core/video'
import type { ColorAdjust, HdrMode, ResolutionCap } from '@shared/types'

let gammaSeq = 0

// Containers Chromium's demuxer actually handles. HEVC/H.265 now decodes
// inside mp4/mov/m4v (PlatformHEVCDecoderSupport). General Matroska (.mkv),
// AVI, WMV, FLV, TS etc. are NOT demuxed by Chromium and route to the mpv
// engine; codec errors inside a supported container surface honest messaging.
const PLAYABLE = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

type Handler = (...args: never[]) => void

export class HtmlVideoEngine implements PlaybackEngine {
  readonly caps: EngineCaps = {
    id: 'html5',
    name: 'Chromium (H.264 · HEVC · VP9 · AV1)',
    canPlayExt: (ext) => PLAYABLE.has(ext.toLowerCase()),
    pictureInPicture: true,
    audioTrackSwitching: false,
    preciseFrameStep: false
  }

  private video: HTMLVideoElement
  private host: HTMLElement | null = null
  private resizeObs: ResizeObserver | null = null
  private cap: ResolutionCap = 'auto'
  private fit: VideoFit = 'contain'
  private gammaFilter: SVGFilterElement | null = null
  private gammaFuncs: SVGElement[] = []
  private gammaId = `lumen-gamma-${gammaSeq++}`
  private listeners = new Map<keyof EngineEvents, Set<Handler>>()
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private eqNodes: BiquadFilterNode[] = []
  private normalizeOn = false
  private eqOn = false
  private boost = 1
  private status: PlaybackStatus = 'idle'
  private rafId = 0
  /** Streaming files (MediaRecorder WebMs, partial recordings) report
   *  duration=Infinity until we force resolution by seeking far past the end. */
  private resolvingDuration = false
  private pendingStart = 0
  /** Decode-stall watchdog: detects "meant to be playing but making no
   *  progress and out of buffered data" — i.e. a codec the built-in engine
   *  can't decode (HEVC, 10-bit, Dolby/DTS) — so the store can fall back to
   *  mpv. This is the case that otherwise just looks like the video froze. */
  private wantPlaying = false
  private stallInterval = 0
  private lastProgressTime = 0
  private lastProgressAt = 0

  constructor() {
    const v = document.createElement('video')
    v.playsInline = true
    v.preload = 'auto'
    v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:transparent;display:block;'
    this.video = v
    this.wireEvents()
  }

  private emit<E extends keyof EngineEvents>(event: E, ...args: Parameters<EngineEvents[E]>): void {
    const set = this.listeners.get(event)
    if (set) for (const fn of set) (fn as (...a: unknown[]) => void)(...args)
  }

  on<E extends keyof EngineEvents>(event: E, fn: EngineEvents[E]): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn as Handler)
    return () => set.delete(fn as Handler)
  }

  private setStatus(s: PlaybackStatus): void {
    if (this.status !== s) {
      this.status = s
      this.emit('status', s)
    }
  }

  private wireEvents(): void {
    const v = this.video
    v.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(v.duration)) {
        this.resolvingDuration = true
        v.currentTime = 1e10
      } else if (this.pendingStart > 0 && this.pendingStart < v.duration - 2) {
        v.currentTime = this.pendingStart
        this.pendingStart = 0
      }
    })
    v.addEventListener('durationchange', () => {
      if (!Number.isFinite(v.duration)) return
      if (this.resolvingDuration) {
        this.resolvingDuration = false
        const start = this.pendingStart > 0 && this.pendingStart < v.duration - 2 ? this.pendingStart : 0
        this.pendingStart = 0
        v.currentTime = start
      }
      this.emit('duration', v.duration || 0)
    })
    v.addEventListener('playing', () => {
      this.setStatus('playing')
      this.startTimeLoop()
    })
    v.addEventListener('pause', () => {
      if (this.status !== 'ended') this.setStatus('paused')
      this.stopTimeLoop()
      this.emit('time', v.currentTime)
    })
    v.addEventListener('waiting', () => this.setStatus('buffering'))
    v.addEventListener('canplay', () => {
      if (this.status === 'buffering' || this.status === 'loading') {
        this.setStatus(v.paused ? 'paused' : 'playing')
      }
    })
    v.addEventListener('ended', () => {
      this.wantPlaying = false
      this.disarmStallWatch()
      this.setStatus('ended')
      this.emit('ended')
    })
    v.addEventListener('ratechange', () => this.emit('rate', v.playbackRate))
    v.addEventListener('progress', () => this.emitBuffered())
    v.addEventListener('seeking', () => this.emit('time', v.currentTime))
    v.addEventListener('seeked', () => this.emit('time', v.currentTime))
    v.addEventListener('resize', () => {
      if (v.videoWidth) {
        this.emit('dimensions', { width: v.videoWidth, height: v.videoHeight })
        this.applyResolutionCap()
      }
    })
    v.addEventListener('loadedmetadata', () => {
      if (v.videoWidth) {
        this.emit('dimensions', { width: v.videoWidth, height: v.videoHeight })
        this.applyResolutionCap()
      }
    })
    v.addEventListener('error', () => {
      this.wantPlaying = false
      this.disarmStallWatch()
      const err = v.error
      let msg = 'This file could not be played.'
      if (err?.code === MediaError.MEDIA_ERR_DECODE) msg = 'decode'
      else if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) msg = 'unsupported'
      else if (err?.code === MediaError.MEDIA_ERR_NETWORK) msg = 'network'
      this.setStatus('error')
      this.emit('error', msg)
    })
    v.addEventListener('enterpictureinpicture', () => this.emit('pip', true))
    v.addEventListener('leavepictureinpicture', () => this.emit('pip', false))
  }

  private startTimeLoop(): void {
    cancelAnimationFrame(this.rafId)
    const tick = (): void => {
      this.emit('time', this.video.currentTime)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }
  private stopTimeLoop(): void {
    cancelAnimationFrame(this.rafId)
  }

  private armStallWatch(): void {
    this.disarmStallWatch()
    this.lastProgressTime = this.video.currentTime
    this.lastProgressAt = Date.now()
    this.stallInterval = window.setInterval(() => this.checkStall(), 2000)
  }
  private disarmStallWatch(): void {
    if (this.stallInterval) {
      clearInterval(this.stallInterval)
      this.stallInterval = 0
    }
  }
  private checkStall(): void {
    const v = this.video
    if (!this.wantPlaying || v.paused || v.ended) return
    // Real progress since last tick → healthy; reset the baseline.
    if (v.currentTime > this.lastProgressTime + 0.25) {
      this.lastProgressTime = v.currentTime
      this.lastProgressAt = Date.now()
      return
    }
    // Meant to be playing, but time is frozen and there's no buffered data to
    // decode into. On a local file that means the codec itself can't advance.
    if (Date.now() - this.lastProgressAt > 7000 && v.readyState < v.HAVE_FUTURE_DATA) {
      this.disarmStallWatch()
      this.wantPlaying = false
      this.setStatus('error')
      this.emit('error', 'stall')
    }
  }

  private emitBuffered(): void {
    const b = this.video.buffered
    const ranges: Array<[number, number]> = []
    for (let i = 0; i < b.length; i++) ranges.push([b.start(i), b.end(i)])
    this.emit('buffered', ranges)
  }

  attach(host: HTMLElement): void {
    this.host = host
    host.appendChild(this.video)
    this.ensureGammaFilter()
    this.resizeObs?.disconnect()
    this.resizeObs = new ResizeObserver(() => this.applyResolutionCap())
    this.resizeObs.observe(host)
    this.applyResolutionCap()
  }

  private ensureGammaFilter(): void {
    if (this.gammaFilter) return
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
    const filter = document.createElementNS(NS, 'filter')
    filter.setAttribute('id', this.gammaId)
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    const transfer = document.createElementNS(NS, 'feComponentTransfer')
    for (const ch of ['feFuncR', 'feFuncG', 'feFuncB']) {
      const f = document.createElementNS(NS, ch)
      f.setAttribute('type', 'gamma')
      f.setAttribute('amplitude', '1')
      f.setAttribute('exponent', '1')
      f.setAttribute('offset', '0')
      transfer.appendChild(f)
      this.gammaFuncs.push(f as unknown as SVGElement)
    }
    filter.appendChild(transfer)
    svg.appendChild(filter)
    document.body.appendChild(svg)
    this.gammaFilter = filter as unknown as SVGFilterElement
  }

  setVideoGrade(color: ColorAdjust, hdr: HdrMode): void {
    this.ensureGammaFilter()
    for (const f of this.gammaFuncs) f.setAttribute('exponent', String(color.gamma))
    this.video.style.filter = buildFilter(color, hdr, this.gammaId)
  }

  setResolutionCap(cap: ResolutionCap): void {
    this.cap = cap
    this.applyResolutionCap()
  }

  sourceSize(): { width: number; height: number } | null {
    return this.video.videoWidth ? { width: this.video.videoWidth, height: this.video.videoHeight } : null
  }

  private applyResolutionCap(): void {
    const v = this.video
    const host = this.host
    const plan = host
      ? planRender(host.clientWidth, host.clientHeight, v.videoWidth, v.videoHeight, this.cap)
      : { raster: null }
    if (!plan.raster) {
      // native: fill host, honor fit mode
      v.style.position = ''
      v.style.left = ''
      v.style.top = ''
      v.style.transform = ''
      v.style.transformOrigin = ''
      v.style.width = '100%'
      v.style.height = '100%'
      v.style.objectFit = this.fit
      return
    }
    const { w, h, left, top, scale } = plan.raster
    // rasterize at the capped resolution, then GPU-scale the layer to fit
    v.style.position = 'absolute'
    v.style.left = `${left}px`
    v.style.top = `${top}px`
    v.style.width = `${w}px`
    v.style.height = `${h}px`
    v.style.objectFit = 'fill'
    v.style.transformOrigin = 'top left'
    v.style.transform = `scale(${scale})`
  }

  private ensureAudioGraph(): void {
    if (this.ctx) return
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' })
      const src = ctx.createMediaElementSource(this.video)
      const gain = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -28
      comp.knee.value = 24
      comp.ratio.value = 6
      comp.attack.value = 0.004
      comp.release.value = 0.24
      this.eqNodes = EQ_FREQS.map((f, i) => {
        const n = ctx.createBiquadFilter()
        n.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
        n.frequency.value = f
        n.Q.value = 1.1
        n.gain.value = 0
        return n
      })
      this.ctx = ctx
      this.gain = gain
      this.compressor = comp
      src.connect(gain)
      this.rewireGraph()
    } catch {
      // Audio graph is an enhancement — element playback continues without it
      this.ctx = null
    }
  }

  private rewireGraph(): void {
    const ctx = this.ctx
    const gain = this.gain
    if (!ctx || !gain) return
    gain.disconnect()
    for (const n of this.eqNodes) n.disconnect()
    this.compressor?.disconnect()

    let node: AudioNode = gain
    if (this.eqOn) {
      for (const n of this.eqNodes) {
        node.connect(n)
        node = n
      }
    }
    if (this.normalizeOn && this.compressor) {
      node.connect(this.compressor)
      node = this.compressor
    }
    node.connect(ctx.destination)
  }

  async load(src: string, opts?: { startAt?: number; autoplay?: boolean }): Promise<void> {
    const v = this.video
    this.setStatus('loading')
    this.resolvingDuration = false
    this.pendingStart = opts?.startAt ?? 0
    setVideoSource(v, src)
    v.load()
    if (opts?.autoplay !== false) {
      this.wantPlaying = true
      this.armStallWatch()
      try {
        this.ensureAudioGraph()
        void this.ctx?.resume()
        await v.play()
      } catch {
        // Autoplay rejected (browser preview without gesture) — stay paused
        this.wantPlaying = false
        this.disarmStallWatch()
        this.setStatus('paused')
      }
    }
  }

  play(): void {
    this.ensureAudioGraph()
    void this.ctx?.resume()
    this.wantPlaying = true
    this.armStallWatch()
    void this.video.play().catch(() => {
      this.wantPlaying = false
      this.disarmStallWatch()
      this.setStatus('paused')
    })
  }
  pause(): void {
    this.wantPlaying = false
    this.disarmStallWatch()
    this.video.pause()
  }
  seek(seconds: number): void {
    const v = this.video
    const d = Number.isFinite(v.duration) ? v.duration : Infinity
    v.currentTime = Math.max(0, Math.min(seconds, d - 0.05))
    if (this.status === 'ended' && v.currentTime < d - 0.5) this.setStatus('paused')
  }
  setRate(rate: number): void {
    this.video.playbackRate = Math.max(0.1, Math.min(8, rate))
  }
  setVolume(vol: number): void {
    this.video.volume = Math.max(0, Math.min(1, vol))
  }
  setMuted(m: boolean): void {
    this.video.muted = m
  }
  setBoost(b: number): void {
    this.boost = Math.max(1, Math.min(3, b))
    this.ensureAudioGraph()
    if (this.gain) this.gain.gain.value = this.boost
  }
  setNormalize(on: boolean): void {
    this.normalizeOn = on
    this.ensureAudioGraph()
    this.rewireGraph()
  }
  setEq(bandsDb: number[], enabled: boolean): void {
    this.eqOn = enabled && bandsDb.some((b) => b !== 0)
    this.ensureAudioGraph()
    this.eqNodes.forEach((n, i) => {
      n.gain.value = Math.max(-12, Math.min(12, bandsDb[i] ?? 0))
    })
    this.rewireGraph()
  }
  setFit(fit: VideoFit): void {
    this.fit = fit
    this.applyResolutionCap()
  }
  frameStep(dir: 1 | -1): void {
    this.video.pause()
    // Chromium has no frame API on <video>; ~1/30s is right for most content.
    this.seek(this.video.currentTime + dir / 30)
  }
  async captureFrame(): Promise<string | null> {
    const v = this.video
    if (!v.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    try {
      ctx.drawImage(v, 0, 0)
      return canvas.toDataURL('image/png')
    } catch {
      return null // cross-origin frame (browser mock samples)
    }
  }
  async requestPip(): Promise<void> {
    if (document.pictureInPictureElement === this.video) {
      await document.exitPictureInPicture()
    } else {
      await this.video.requestPictureInPicture()
    }
  }
  currentTime(): number {
    return this.video.currentTime
  }
  quality(): { dropped: number; total: number } | null {
    const q = this.video.getVideoPlaybackQuality?.()
    return q ? { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } : null
  }
  destroy(): void {
    this.wantPlaying = false
    this.disarmStallWatch()
    this.stopTimeLoop()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.video.remove()
    this.gammaFilter?.ownerSVGElement?.remove()
    this.gammaFilter = null
    this.gammaFuncs = []
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.listeners.clear()
  }
}
