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

**Shipped (v0.1.4–v0.1.6):** HEVC/H.265 decode enabled in the built-in engine (MP4/MOV) with the HDR pipeline; `MpvEngine` sidecar that detects an installed mpv (plain **or** mpv.net) and plays MKV/AVI/WMV/FLV/TS and true-HDR content via JSON IPC (`--vo=gpu-next` + tone-mapping); engine auto-selection; in-app setup/locate flow; **embedded audio + subtitle track switching** (mpv `track-list` → Lumen's menus); **resume position** for mpv items; unit-tested protocol/selection/detection/track-parsing logic. **Verified end-to-end**: mpv decodes a real HEVC-in-MKV and answers IPC (duration/codec/dimensions). See ADR-012/013.

**Remaining:** in-Lumen-window rendering (currently mpv uses its own GPU window), precise-seek modes, mpv-side screenshots/thumbnails, optional bundled mpv, and on-HDR-hardware verification of passthrough.

## M4 (original scope, for reference) 🔜

Bundle libmpv; `MpvEngine` implementing the same interface (child-window render target behind transparent UI); per-file engine selection with fallback; unlocks MKV/AVI/FLV/WMV/MPEG/TS, HEVC 10-bit, HDR passthrough, embedded audio/subtitle track switching, audio delay, precise seek modes. Add codec/pixel-format/HDR fields to stats overlay and info panel.

**Acceptance**: the full container/codec matrix in the product brief plays; track switching works on an MKV with 3 audio + 2 subtitle tracks.

## M5 — Media tooling 🔜

ffmpeg sidecar: clip export (HW encode), GIF capture, batch thumbnailing for engine-unsupported formats; chapter extraction; Skip Intro/Credits via per-series learned markers; bookmarks UI on timeline; subtitle search/download provider interface + OpenSubtitles plugin (opt-in networking); volume normalization via loudness scan; metadata editor.

## M6 — Plugin SDK 🔜

Stabilize registry APIs (engines/commands/themes/providers/sources); manifest + sandboxed loading + permission prompts; theme marketplace format; sample plugins (visualizer, cloud source); developer docs.

## Continuous

Performance budgets in CI (startup trace, bundle size), accessibility audits per milestone, zero-network default enforced by test.
