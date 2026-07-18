// The playback engine seam. The UI depends only on these types — never on
// <video> directly — so a libmpv engine can slot in without UI changes (M4).

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

/** How the video maps onto the surface */
export type VideoFit = 'contain' | 'cover' | 'fill' | 'none'

export interface EngineCaps {
  id: string
  name: string
  /** file extensions this engine can likely play */
  canPlayExt(ext: string): boolean
  pictureInPicture: boolean
  audioTrackSwitching: boolean
  preciseFrameStep: boolean
}

export interface EngineEvents {
  time: (sec: number) => void
  duration: (sec: number) => void
  status: (s: PlaybackStatus) => void
  buffered: (ranges: Array<[number, number]>) => void
  rate: (r: number) => void
  dimensions: (d: { width: number; height: number }) => void
  error: (message: string) => void
  ended: () => void
  pip: (active: boolean) => void
}

export interface PlaybackEngine {
  readonly caps: EngineCaps
  attach(host: HTMLElement): void
  load(src: string, opts?: { startAt?: number; autoplay?: boolean }): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  setRate(rate: number): void
  /** 0..1 element volume */
  setVolume(v: number): void
  setMuted(m: boolean): void
  /** 1..3 pre-amp boost via WebAudio */
  setBoost(b: number): void
  setNormalize(on: boolean): void
  setEq(bandsDb: number[], enabled: boolean): void
  setFit(fit: VideoFit): void
  /** Color/HDR grade via CSS + SVG filters */
  setVideoGrade(color: import('@shared/types').ColorAdjust, hdr: import('@shared/types').HdrMode): void
  /** Cap the render (downscale) height; 'auto' renders at native size */
  setResolutionCap(cap: import('@shared/types').ResolutionCap): void
  /** Natural source dimensions, once known */
  sourceSize(): { width: number; height: number } | null
  frameStep(dir: 1 | -1): void
  captureFrame(): Promise<string | null> // png data URL
  requestPip(): Promise<void>
  currentTime(): number
  on<E extends keyof EngineEvents>(event: E, fn: EngineEvents[E]): () => void
  destroy(): void
}
