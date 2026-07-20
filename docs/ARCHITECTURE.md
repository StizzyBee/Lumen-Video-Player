# Lumen — Architecture

This document describes the complete application architecture. It was written before implementation and is kept current as the source of truth. Rationale for the big choices lives in [DECISIONS.md](DECISIONS.md).

## 1. Goals and non-goals

**Goals**

- Premium, Fluent-inspired UI with 60fps motion; startup-to-interactive under 2 seconds.
- Real library management (scan, watch, search, resume) — not just "open file".
- Broad codec coverage, hardware-decoded, with a path to *every* format via a swappable playback engine.
- Modular architecture: features are additive, playback engines and providers are pluggable.
- Fully offline and private by default.

**Non-goals (v1)**

- Streaming services, network shares, DLNA/casting (plugin territory, M6).
- Media server management (Jellyfin/Plex — plugin territory).
- Editing beyond clip/GIF export.

## 2. Process model

Lumen is an Electron app with three strictly separated realms:

```
┌────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node)                    src/main/                   │
│  window mgmt · Mica material · single-instance · file assoc        │
│  LibraryStore (JSON, atomic writes) · Scanner · FS watcher         │
│  SettingsStore · lumen:// media protocol (Range streaming)         │
│  thumbnail cache (disk) · dialogs · shell integration              │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ typed IPC (src/shared/ipc.ts contract)
┌──────────────────────────┴─────────────────────────────────────────┐
│ PRELOAD (contextIsolation)             src/preload/                │
│  exposes exactly one object: window.lumen — a typed, promise-      │
│  based API. No Node primitives ever reach the renderer.            │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ window.lumen (LumenApi)
┌──────────────────────────┴─────────────────────────────────────────┐
│ RENDERER (Chromium, GPU)               src/renderer/               │
│  React UI · design system · Zustand stores · PlaybackEngine        │
│  command registry · shortcut registry · thumbnail generator        │
└────────────────────────────────────────────────────────────────────┘
```

Security posture: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer. All privileged operations go through the audited `lumen` bridge. Media bytes are served over a custom `lumen://` protocol with Range support so the renderer never touches the filesystem directly.

## 3. Renderer layering

Dependencies point strictly downward. Nothing in `design/` or `components/` knows about video; nothing in `core/` knows about React.

```
features/   home · library · player · playlists · settings · palette
    │  (feature UIs compose primitives and talk to stores/commands)
components/ Button · Slider · Menu · Dialog · Toast · Card · Skeleton …
    │  (pure presentational primitives, token-driven, zero business logic)
core/       stores (zustand) · commands · shortcuts · engine/ · platform
    │  (framework-free logic; platform = the only module touching window.lumen)
design/     tokens.css · themes · motion constants · icon conventions
shared/     types.ts · ipc.ts  (compiled into all three realms)
```

### Module map

| Module | Responsibility |
| --- | --- |
| `core/platform.ts` | Sole gateway to `window.lumen`. In a plain browser it transparently installs `platform.mock.ts` (demo library, localStorage persistence) so the entire UI runs and is testable without Electron. |
| `core/store/settings.ts` | Settings state, persistence, theme/accent application to the DOM. |
| `core/store/library.ts` | Library items, scan status, search index, derived rows (Continue Watching, Recent…). |
| `core/store/player.ts` | Playback session state: current item, queue, transport state mirrored from the engine. |
| `core/store/ui.ts` | Navigation (view state machine), overlays, toasts, context menus, fullscreen. |
| `core/engine/` | `PlaybackEngine` interface + implementations. UI depends only on the interface. |
| `core/commands.ts` | Central command registry: id, title, category, keywords, handler, `when` predicate. Palette, menus, and shortcuts all execute through it. |
| `core/shortcuts.ts` | Keymap: default bindings + user overrides; dispatches to commands. |
| `core/subtitles.ts` | SRT/VTT parsing, cue timing/delay, active-cue selection. |

## 4. The playback engine abstraction

The single most important seam in the codebase. The UI is written against an interface, never against `<video>`:

```ts
interface PlaybackEngine {
  readonly caps: EngineCaps;                    // formats, pip, audioTracks…
  attach(host: HTMLElement): void;              // engine owns its surface
  load(src: MediaSource_, startAt?: number): Promise<void>;
  play(): void; pause(): void;
  seek(seconds: number, opts?: { fast?: boolean }): void;
  setRate(r: number): void; setVolume(v: number): void; setMuted(m: boolean): void;
  frameStep(dir: 1 | -1): void;
  captureFrame(): Promise<Blob | null>;
  audioTracks(): TrackInfo[]; setAudioTrack(id: string): void;
  requestPip(): Promise<void>;
  on<E extends keyof EngineEvents>(e: E, fn: EngineEvents[E]): () => void;
  destroy(): void;
}
```

- **`HtmlVideoEngine` (shipped, M1)** — Chromium `<video>` + WebAudio graph (gain boost → 10-band EQ → compressor "normalize"). Hardware-decoded H.264/VP9/AV1/HEVC*, containers MP4/WebM/MOV/M4V (+ Matroska where codecs allow). PiP, frame capture, playbackRate 0.06–16.
- **mpv sidecar engine (shipped, M4)** — a detected (or one-click winget-installed) `mpv.exe` renders into a frameless child window embedded inside Lumen's own window (`--wid`), driven over JSON IPC (`src/main/mpv/`); unlocks MKV/AVI/FLV/WMV/MPEG, every codec, embedded tracks, and true HDR passthrough on HDR displays (`gpu-next` + `target-colorspace-hint`), with the HDR mode + color grade applied live via `set_property` (`grade.ts` is the single mapping for launch args and runtime updates). Plain mpv only — mpv.net ignores `--wid` and falls back to its own window. Engine selection per-file with graceful fallback: if `HtmlVideoEngine.canPlay(item)` is false and mpv is installed → mpv; else prompt to install.

The registry (`core/engine/registry.ts`) makes engines a plugin point from day one.

## 5. Data model

Persistence is deliberately boring: JSON documents with atomic writes (write temp + rename), debounced, versioned with migration hooks. See ADR-003 for why not SQLite in v1.

```
%APPDATA%/lumen/
  settings.json      user preferences (schema below)
  library.json       LibraryItem[] + folder list + revision
  playlists.json     saved playlists
  thumbs/{id}.jpg    thumbnail cache (id = sha1 of absolute path)
```

```ts
interface LibraryItem {
  id: string;            // sha1(path)
  path: string; fileName: string; title: string;   // title = cleaned name
  folder: string; ext: string; sizeBytes: number; mtimeMs: number;
  addedAt: number;
  durationSec?: number; width?: number; height?: number;  // probed lazily
  thumbReady?: boolean;
  favorite: boolean; pinned: boolean; tags: string[];
  lastPlayedAt?: number; positionSec?: number; playCount: number;
  subtitles: string[];   // sidecar files discovered next to the video
}
```

Derived rows (computed in `store/library.ts`, memoized):
- **Continue Watching** — `position/duration ∈ (0.5%, 96%)`, sorted by `lastPlayedAt` desc.
- **Recently Added** — `addedAt` desc. **Recent** — `lastPlayedAt` desc. **Pinned/Favorites** — flags.
- **Folders** — group by top-level watched folder.

### Indexing pipeline

```
watch folders ──► Scanner (main): walk, stat, diff against store
                     │  emits library:changed (batched)
Renderer ◄───────────┘
   │ ProbeQueue (idle, concurrency 2): offscreen <video> → duration/dims
   │ ThumbQueue (idle): seek 12% → canvas → JPEG → lumen.thumbs.save()
   └─► store updates → UI animates in
```

Everything is incremental and non-blocking; a 10k-file library must never jank the UI (lists are virtualized, probing is idle-scheduled).

## 6. IPC contract (`window.lumen`)

Defined once in `src/shared/ipc.ts`; preload and main are both typed against it.

| Namespace | Methods | Events |
| --- | --- | --- |
| `win` | minimize, toggleMaximize, close, setFullscreen, setAlwaysOnTop, setMiniMode | maximized-changed, fullscreen-changed |
| `library` | getState, addFolder (dialog), removeFolder, rescan, updateItem, openFileDialog | changed (batched diffs), scan-progress |
| `media` | url(path) → `lumen://media/...`, readSidecarText(path) | — |
| `thumbs` | save(id, jpegBytes), url(id) | — |
| `settings` | get, patch | changed |
| `playlists` | list, save, delete | — |
| `shell` | showInFolder, openExternal *(user-gesture gated)* | — |
| `app` | version, openedWith (file-assoc argv) | open-file |

Rules: every method is promise-based; events deliver immutable snapshots/diffs; the renderer never sends raw paths it didn't receive from main or a user gesture (drag-drop/dialog).

## 7. Plugin architecture (design now, SDK in M6)

Lumen is built around registries so that "plugin" is a first-class concept internally before the external SDK exists:

| Registry | Exists today | External plugin examples later |
| --- | --- | --- |
| Playback engines | ✅ html5 (mpv next) | codec packs, visualizers |
| Commands | ✅ all app actions | anything — palette is auto-populated |
| Themes | ✅ dark/light/oled + accent | full custom themes |
| Subtitle providers | interface reserved | OpenSubtitles search/download |
| Metadata providers | interface reserved | TMDB posters, NFO readers |
| Sources | interface reserved | cloud drives, media servers, YouTube |

A future plugin is a manifest + JS module loaded in a locked-down utility process, contributing to these registries over a versioned API — same model as VS Code extensions. Nothing in the core may bypass a registry to hardcode behavior that belongs to one.

## 8. Performance strategy

- **Startup**: main creates the window immediately with a background-color matching the theme (no white flash); renderer bundle is code-split (player and settings lazy); library loads from JSON snapshot synchronously in main and streams to the renderer; target ≤ 1.5s cold to interactive home.
- **Rendering**: only `transform`/`opacity` animations (compositor-only); `content-visibility` + virtualization for grids; thumbnails are decoded off-main-thread (`img decoding="async"`, `loading="lazy"`).
- **Media**: `lumen://` streaming with Range requests → instant seeks; hardware decode on by default; `powerSaveBlocker` during playback.
- **Memory**: one engine instance; thumbnails on disk not in state; probe queues bounded.

## 9. Error handling

- Every IPC handler returns `Result`-shaped data or throws typed errors; the bridge normalizes them; stores route failures to non-blocking toasts with a retry action where meaningful.
- Media errors map to human copy ("This file's codec (HEVC 10-bit) isn't supported yet — the mpv engine in M4 will play it") with a *Show in folder* action, never a raw error code.
- The scanner is crash-isolated: a single unreadable file logs and skips; store writes are atomic so a crash can't corrupt the library.
- Renderer `ErrorBoundary` per feature surface: a crash in Settings can't take down playback.

## 10. Testing strategy

| Layer | Tool | What |
| --- | --- | --- |
| core logic | Vitest | subtitle parsing/timing, fuzzy search, format utils, resume rules, keymap resolution, command registry |
| stores | Vitest | derived rows, settings migration, queue behavior (mock platform) |
| main | Vitest (node env) | scanner diffing, atomic store writes, title cleaning |
| UI | manual + `dev:web` mock mode | every feature runs in a plain browser with demo data, making visual review trivial |

CI-ready scripts: `npm test`, `npm run typecheck`, `npm run build`.
