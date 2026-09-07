import type { ContentRef, TogetherEvent } from './together/api'
import type { MeshProvider, MeshStatus, NetAddress } from './together/mesh'
import type {
  ColorAdjust,
  DownloadProgress,
  LibraryItem,
  LibraryState,
  Playlist,
  ScanProgress,
  Settings
} from './types'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export type Unsubscribe = () => void

/**
 * The complete privileged surface available to the renderer as `window.lumen`.
 * Implemented by src/preload (Electron) and by core/platform.mock (browser).
 */
export interface LumenApi {
  win: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    setFullscreen(on: boolean): void
    isMaximized(): Promise<boolean>
    setMiniMode(on: boolean): void
    /** Native page zoom — correct input hit-testing at any UI scale */
    setZoomFactor(factor: number): void
    onMaximized(cb: (maximized: boolean) => void): Unsubscribe
    onFullscreen(cb: (fullscreen: boolean) => void): Unsubscribe
  }
  library: {
    getState(): Promise<LibraryState>
    /** Opens a folder picker; resolves when the folder is added (scan continues async) */
    addFolder(): Promise<LibraryState | null>
    removeFolder(folder: string): Promise<LibraryState>
    rescan(): Promise<void>
    updateItem(id: string, patch: Partial<LibraryItem>): Promise<void>
    /** Register loose files (drag-drop / Open dialog / file association) */
    addPaths(paths: string[]): Promise<LibraryItem[]>
    openFileDialog(): Promise<string[] | null>
    onChanged(cb: (state: LibraryState) => void): Unsubscribe
    onScanProgress(cb: (p: ScanProgress) => void): Unsubscribe
  }
  media: {
    /** Streamable URL for a media file (lumen:// protocol with Range support) */
    url(path: string): string
    /** Read a sidecar subtitle file as text */
    readText(path: string): Promise<string>
    /** Absolute path for a File dropped onto the window */
    pathForFile(file: File): string
  }
  thumbs: {
    save(id: string, jpegDataUrl: string): Promise<void>
    url(id: string): string
  }
  settings: {
    get(): Promise<Settings>
    patch(patch: DeepPartial<Settings>): Promise<Settings>
    onChanged(cb: (s: Settings) => void): Unsubscribe
  }
  playlists: {
    list(): Promise<Playlist[]>
    save(p: Playlist): Promise<void>
    remove(id: string): Promise<void>
  }
  /** Optional mpv sidecar engine for MKV/AVI/HEVC/HDR (beta). */
  mpv: {
    /** Resolve an installed mpv.exe path, or null if not found */
    detect(): Promise<string | null>
    /** Open a picker to locate mpv.exe manually; persists + returns the path */
    locate(): Promise<string | null>
    /** Windows Package Manager present? Gates the one-click install offer. */
    hasWinget(): Promise<boolean>
    /** Install mpv via winget; resolves with the detected path on success */
    install(): Promise<{ ok: boolean; path?: string | null; reason?: string }>
    /** Live status lines while an install runs (for transparency) */
    onInstallProgress(cb: (line: string) => void): Unsubscribe
    /** Launch mpv to play a file; resolves with whether it embedded into Lumen's window */
    play(
      path: string,
      opts: {
        hdr: 'auto' | 'vivid' | 'off'
        color?: ColorAdjust
        hwdec: boolean
        volume: number
        startAt?: number
      }
    ): Promise<{ embedded: boolean }>
    /** Position the embedded-video surface to match a region of the renderer (screen px derived in main) */
    setSurfaceRect(rect: { x: number; y: number; width: number; height: number; innerWidth: number }): void
    /** Apply HDR mode + color adjustments to the running mpv instance */
    setGrade(color: ColorAdjust, hdr: 'auto' | 'vivid' | 'off'): void
    playPause(paused: boolean): void
    seek(sec: number): void
    setRate(rate: number): void
    setVolume(v: number): void
    setMuted(m: boolean): void
    setAudioTrack(id: number): void
    setSubTrack(id: number | 'no'): void
    frameStep(dir: 1 | -1): void
    /** Save a frame from mpv's window via a save dialog; resolves to the written path or null */
    screenshot(suggestedName: string): Promise<string | null>
    stop(): void
    onEvent(cb: (e: { type: string; name?: string; data?: unknown; message?: string }) => void): Unsubscribe
  }
  /** yt-dlp powered downloads: pull a video from a website into the library. */
  downloads: {
    /** Resolve installed tool paths (yt-dlp + the ffmpeg it needs for 1080p+ merges) */
    detect(): Promise<{ ytdlp: string | null; ffmpeg: string | null }>
    hasWinget(): Promise<boolean>
    /** One-click install of yt-dlp + FFmpeg via winget */
    install(): Promise<{ ok: boolean; reason?: string }>
    onInstallProgress(cb: (line: string) => void): Unsubscribe
    /** Start a download; progress arrives via onProgress until done/error */
    start(url: string): Promise<{ id: string }>
    cancel(id: string): void
    onProgress(cb: (e: DownloadProgress) => void): Unsubscribe
  }
  /**
   * Together: synchronized watch parties. The relay socket lives in main so
   * the renderer keeps its hands off the network, and so the clock estimate is
   * not measured on a thread busy compositing video.
   */
  together: {
    /** Start the built-in relay and join it. Resolves with what to share. */
    host(opts: { name: string; memberId: string; content: ContentRef | null; port?: number }): Promise<{
      roomId: string
      port: number
      /** Addresses to hand a friend, most-likely-to-work first. */
      addresses: NetAddress[]
    }>
    /** Join a room on someone else's relay. */
    join(opts: {
      url: string
      roomId: string
      name: string
      memberId: string
      content: ContentRef | null
    }): Promise<void>
    leave(): void
    /** Ask the room to change the timeline. The relay decides; it may refuse. */
    intent(kind: 'play' | 'pause' | 'seek' | 'rate', mediaTime: number, rate?: number): void
    /** Heartbeat carrying this watcher's readiness and measured drift. */
    report(data: { ready: boolean; bufferedAhead: number; mediaTime: number; driftMs: number }): void
    setContent(content: ContentRef): void
    callVote(kind: 'resume' | 'revoke', targetId?: string, durationMs?: number): void
    vote(ballotId: string, choice: 'yes' | 'no'): void
    onEvent(cb: (e: TogetherEvent) => void): Unsubscribe
    /**
     * Mesh VPN support — the answer to NAT, and so to watching together from
     * different continents without anyone touching a router.
     */
    mesh: {
      /** What is installed, and which addresses currently reach the world. */
      status(): Promise<MeshStatus>
      /** Windows Package Manager present? Gates the one-click install offer. */
      hasWinget(): Promise<boolean>
      /** Install ZeroTier or Tailscale from its official source via winget. */
      install(provider: 'zerotier' | 'tailscale'): Promise<{ ok: boolean; reason?: string }>
      onInstallProgress(cb: (line: string) => void): Unsubscribe
      /** Join a ZeroTier network by id. Prompts for elevation. */
      joinZeroTier(networkId: string): Promise<{ ok: boolean; reason?: string }>
      /** Open the provider's sign-up / network page in the browser. */
      openSetup(provider: MeshProvider): void
    }
  }
  shell: {
    showInFolder(path: string): void
    /** Save a captured frame; returns the chosen path or null if cancelled */
    saveScreenshot(pngDataUrl: string, suggestedName: string): Promise<string | null>
  }
  app: {
    version(): Promise<string>
    readonly platform: 'win32' | 'browser'
    /** File passed via CLI/file-association at launch, if any */
    getOpenedFile(): Promise<string | null>
    onOpenFile(cb: (path: string) => void): Unsubscribe
    /** Lets main hold/release a display-sleep blocker */
    setPlaying(playing: boolean): void
  }
}
