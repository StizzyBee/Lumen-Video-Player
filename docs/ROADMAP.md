# Lumen — Development Roadmap

Milestones are vertical slices: each one ends with a runnable, testable app. Status reflects this repository.

## M0 — Foundations ✅

Repo, Electron+Vite+TS scaffold, strict typing, design tokens, theme engine (dark/light/OLED/system sync/accent), custom titlebar with Mica, app shell with animated sidebar, view state machine, mock-platform mode (`npm run dev:web`) so the UI runs in a plain browser.

**Acceptance**: window opens themed with custom chrome; themes switch live; UI runs in browser with demo data; `npm test`, `npm run build` green.

## M1 — Playback core ✅

`PlaybackEngine` interface + `HtmlVideoEngine` (HW-decoded H.264/VP9/AV1, WebAudio boost/EQ/normalize graph), `lumen://` Range-streaming protocol, full player UI: auto-hide controls, timeline (buffered ranges, hover time + thumbnail preview), volume, speed menu with custom values, loop & A-B repeat, frame stepping, screenshot to file, PiP, fullscreen, mini always-on-top mode, keyboard + mouse maps (incl. hold-for-2×, wheel volume, middle-click mute), custom context menu, stats overlay, resume-position persistence.

**Acceptance**: open any MP4/WebM via dialog, drag-drop, or file association; every control works; position survives restart; controls hide at 2.8s and never while paused/menu-open.

## M2 — Library & Home ✅

Folder pick + recursive scan + diffing rescan + fs watching in main; JSON store with atomic writes; renderer probe/thumbnail queues (duration, dimensions, JPEG thumbs, idle-scheduled); Home dashboard (Continue Watching hero, Recently Added, Recent, Pinned, Favorites rows); Library page (virtualized grid + list, sorting, filter chips); instant fuzzy search (Ctrl+K) across titles/files/folders/tags; favorites, pins, tags; empty states and loading skeletons.

**Acceptance**: adding a 1k-file folder keeps UI at 60fps; search results < 16ms; thumbnails appear progressively; Continue Watching reflects real positions.

## M2.5 — Windows integration ✅

First-run auto-indexing of the user's Windows Videos folder (`seedDefaultFolder`, one-shot, respects later removal); resolution filter chips in Library (All/4K/1440p/1080p/720p/SD); video fit modes in the player (Fit / Fill / Stretch / Actual size); HDR display-capability detection surfaced in stats and settings; streaming-file duration resolution (MediaRecorder/OBS-style `Infinity` durations); NSIS installer packaging (`npm run dist` → `release/*.exe`).

**Acceptance**: fresh install shows the user's Videos content with names, lengths, and thumbnails without any setup; installer exe produced.

## M3 — Power & polish ✅

Command palette (all commands + files + settings), customizable shortcuts editor with conflict detection, settings page (searchable, live subtitle preview stage, accent picker), external subtitles (SRT/VTT, auto-load sidecars, styling: font/size/color/outline/shadow/background/position/opacity, delay adjust), playlists (create, reorder by drag, shuffle, repeat, persist, M3U import/export), toasts, dialogs, drop overlay, micro-interaction pass, reduced-motion + UI scale accessibility settings.

**Acceptance**: every listed feature reachable by mouse *and* keyboard; palette fuzzy-finds everything; subtitle changes render live while playing.

## M4 — Native engine (mpv) 🟡 in progress

**Shipped (v0.1.4–v0.1.7):** HEVC/H.265 decode enabled in the built-in engine (MP4/MOV) with the HDR pipeline; `MpvEngine` sidecar that detects an installed mpv (plain **or** mpv.net) and plays MKV/AVI/WMV/FLV/TS and true-HDR content via JSON IPC (`--vo=gpu-next` + tone-mapping); engine auto-selection; in-app setup/locate flow; **embedded audio + subtitle track switching** (mpv `track-list` → Lumen's menus); **resume position** for mpv items; **full transport parity** (v0.1.7): frame screenshots via `screenshot-to-file`, live volume/mute, A-B repeat, and loop-one/autoplay-next/loop-all — all sharing the built-in engine's logic (`core/playback-end.ts`); unit-tested protocol/selection/detection/track-parsing/end-action logic. **Verified end-to-end**: mpv decodes a real HEVC-in-MKV and answers IPC (duration/codec/dimensions), writes a valid 1280×720 PNG screenshot, and round-trips volume/mute/seek. See ADR-012/013.

**Automatic engine fallback (v0.1.8):** when the built-in engine can't decode one of its own containers — an `.mp4`/`.mov` that turns out to be HEVC/H.265, or carries Dolby (AC-3/E-AC-3) or DTS audio Chromium won't touch — Lumen now hands the file to mpv automatically (or, if mpv isn't installed, shows a codec-specific "get mpv" prompt instead of a dead stall). A stall watchdog in `HtmlVideoEngine` catches silent freezes (no error event); `core/engine/fallback.ts` is the pure, unit-tested decision. Also adds a manual **Play in mpv engine** command/right-click action and an **Always use mpv** setting. Empirically grounded: this build's Chromium (Electron 38) reports HEVC, AC-3, E-AC-3 and DTS unsupported, and HEVC-in-mp4 raises `MEDIA_ERR_SRC_NOT_SUPPORTED` — the fallback routes both.

**One-click mpv install (v0.1.9):** when a file needs mpv and it isn't installed, the prompt offers **Install mpv automatically** — Lumen installs mpv.net via **winget** (the Windows Package Manager, present on Win10/11) with a clear disclosure (~40 MB, what it's installing) and live status lines; nothing installs silently. Success is decided by re-detecting mpv on disk, *not* winget's exit code (it returns non-zero when the package is already installed). Falls back to opening mpv.io when winget is absent. `src/main/mpv/install.ts`; verified against real winget.

**In-Lumen-window rendering (v0.1.10, experimental):** mpv now renders INTO Lumen's window via `--wid` — a frameless, non-focusable child "surface" window that the renderer positions (over move/resize/zoom) to sit exactly between Lumen's top bar and control bar, so the video appears inside Lumen with Lumen's own controls and no separate mpv window or OSC. Verified at the API level that mpv decodes into an Electron child HWND and follows repositioning; the exact on-screen placement is display-dependent and user-tested. Graceful fallback: if the surface can't be created it reverts to mpv's own window, and Settings → Video → "Play mpv video inside Lumen" (default on) toggles it off. Focus is restored to Lumen after handoff so shortcuts keep working.

**Remaining:** refine embedded placement (auto-hide chrome / full-bleed with a controls overlay window), precise-seek modes, external subtitle sideloading + fit-mode routing for mpv items, pre-probing containers with unsupported *audio* only (Chromium plays those video-only with no error, so they aren't auto-detected yet), mpv thumbnails, optional bundled mpv, and on-HDR-hardware verification of passthrough.

## M4 (original scope, for reference) 🔜

Bundle libmpv; `MpvEngine` implementing the same interface (child-window render target behind transparent UI); per-file engine selection with fallback; unlocks MKV/AVI/FLV/WMV/MPEG/TS, HEVC 10-bit, HDR passthrough, embedded audio/subtitle track switching, audio delay, precise seek modes. Add codec/pixel-format/HDR fields to stats overlay and info panel.

**Acceptance**: the full container/codec matrix in the product brief plays; track switching works on an MKV with 3 audio + 2 subtitle tracks.

## M5 — Media tooling 🔜

ffmpeg sidecar: clip export (HW encode), GIF capture, batch thumbnailing for engine-unsupported formats; chapter extraction; Skip Intro/Credits via per-series learned markers; bookmarks UI on timeline; subtitle search/download provider interface + OpenSubtitles plugin (opt-in networking); volume normalization via loudness scan; metadata editor.

## M6 — Plugin SDK 🔜

Stabilize registry APIs (engines/commands/themes/providers/sources); manifest + sandboxed loading + permission prompts; theme marketplace format; sample plugins (visualizer, cloud source); developer docs.

## Continuous

Performance budgets in CI (startup trace, bundle size), accessibility audits per milestone, zero-network default enforced by test.
