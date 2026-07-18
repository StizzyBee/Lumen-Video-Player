# Lumen — Architecture Decision Records

Each ADR states context, the decision, and consequences. Superseded ADRs are kept and marked.

---

## ADR-001 · Shell: Electron (not Tauri, not WinUI 3)

**Context.** The product brief demands a 2026-grade Fluent UI (blur, Mica, heavy motion, command palette) *and* light weight *and* buildability on the actual dev machine. Toolchain audit of this machine: Node 24 ✅, .NET 10 SDK ✅, **no Rust, no MSVC/Visual Studio C++ toolchain** (vswhere absent).

**Options.**
- *WinUI 3 (C#)*: most native Fluent, but CLI-only builds without Visual Studio are fragile, XAML iteration is slow for this level of custom UI, and codec coverage still requires native FFmpeg interop regardless.
- *Tauri 2 (Rust + WebView2)*: best footprint, but requires Rust **and** the MSVC linker — a multi-GB Visual Studio Build Tools install we can't assume; also complicates the future libmpv child-window integration less than Electron? (comparable), but blocks *today*.
- *Electron*: builds today with Node alone; web UI hits the design bar fastest (the brief's own references — VS Code, Discord — are Electron); `BrowserWindow.backgroundMaterial: 'mica'` gives real Mica; Chromium ships hardware decode for H.264/VP9/AV1 out of the box.

**Decision.** Electron + Vite + React + TypeScript. Counter the known costs deliberately: startup budget enforced (deferred loads, no white flash), RAM kept low (single window, disk-backed thumbs), and the entire platform surface is isolated behind one typed bridge (`window.lumen`) mirroring a Tauri-command shape — a future Tauri/native port replaces `src/main` + `src/preload` without touching the UI.

**Consequences.** +80–150MB baseline RAM vs Tauri accepted for v1; zero-install dev loop; codec ceiling of Chromium until M4 (ADR-004).

---

## ADR-002 · UI stack: React 18 + Zustand + `motion` + hand-rolled design system

React for ecosystem/maintainability; Zustand over Redux for minimal ceremony with excellent selector performance; `motion` (framer-motion successor) for spring physics and layout/presence animations the brief requires. **No component library** (Fluent UI React, shadcn, etc.): the design bar is custom Fluent-inspired, and libraries fight bespoke theming (OLED, accent derivation) more than they help at this scale (~15 primitives). All primitives are built in-house on the token system; `lucide-react` for a single consistent icon family.

---

## ADR-003 · Persistence: versioned JSON stores, not SQLite (v1)

better-sqlite3 is a native module → node-gyp → needs the MSVC toolchain this machine lacks; prebuilt-binary matching across Electron upgrades is a recurring failure mode. Realistic personal libraries (≤ tens of thousands of items) fit comfortably in memory; search is an in-memory index either way. **Decision**: `library.json` / `settings.json` / `playlists.json` with atomic write (temp + rename), debounce, schema `revision` + migration hooks, all behind a `Store` interface so a SQLite implementation can swap in (M4+, when a compile toolchain ships with the mpv work) without callers changing.

---

## ADR-004 · Playback: engine abstraction; HTML5 now, libmpv at M4

One interface (`PlaybackEngine`) owns all transport; UI never touches `<video>` directly. v1 ships `HtmlVideoEngine`: Chromium HW-decoded H.264/VP9/AV1 (+HEVC where OS-licensed), MP4/WebM/MOV, WebAudio chain for boost/EQ/normalization, PiP, frame capture. Full matrix (MKV/AVI/FLV/WMV/MPEG, 10-bit, HDR passthrough, embedded track switching, audio delay) lands with `MpvEngine` (libmpv rendering into a child HWND behind a transparent UI layer — the proven Stremio architecture). Rationale: ships a working, polished player immediately; makes codec breadth an engine swap, not a rewrite; engine registry doubles as the first real plugin point. Unsupported files are detected up front (`canPlay`) and get honest, actionable messaging.

---

## ADR-005 · Thumbnails & probing in the renderer, cache in main

No ffmpeg dependency in v1: an offscreen muted `<video>` seeks to 12%, draws to canvas, and produces JPEG bytes; main persists to `%APPDATA%/lumen/thumbs/{sha1(path)}.jpg` served over `lumen://thumb/`. Idle-scheduled queue (concurrency 2) keeps the UI smooth; formats the engine can't decode fall back to a designed placeholder (accent-tinted glyph + codec badge) until ffmpeg arrives in M5.

---

## ADR-006 · Media delivery: custom `lumen://` protocol with Range support

Renderer is sandboxed with no filesystem access; `file://` in a `http(s)`-origin renderer is blocked and unstreamable. A privileged protocol handler in main streams files with correct `Content-Range`/`206` semantics → instant seeking, zero copies into JS, works identically in dev (Vite origin) and prod, and gives one audited choke point for path access.

---

## ADR-007 · Navigation: in-app view state machine, no router

Four top-level views + overlay stack don't justify URL semantics; a typed state machine in `store/ui.ts` (`view`, `playerSession`, `overlays[]`) gives full control of transition choreography (AnimatePresence) and back-behavior (Esc pops overlays → player → home) without router indirection.

---

## ADR-008 · Privacy: zero network by default, enforced

No telemetry, no update pings, no metadata fetching in core. Anything networked (subtitle download, posters) arrives only as an explicitly enabled plugin/provider (M5+) with per-provider opt-in UI. Dev-time guard: CSP restricts the renderer to `lumen://` + dev-server origins, so an accidental fetch fails loudly in review.

---

## ADR-010 · UI scale via native page zoom, not CSS `zoom`

**Context.** The interface-scale setting first used `#root { zoom: var(--ui-scale) }`. CSS `zoom` visually scales content but Chromium's pointer hit-testing did not always agree with the scaled geometry at the window edges, contributing to controls that needed a pixel-perfect click.

**Decision.** On desktop, apply the scale through `webContents.setZoomFactor()` (a real page zoom that scales layout *and* input coordinates together) and pin `--ui-scale` to 1. The browser mock keeps CSS `zoom` since it has no Electron zoom API. See `core/store/settings.ts`.

**Consequences.** Hit-testing is exact at every scale; scale now also affects native dialogs consistently.

## ADR-011 · Installer: assisted NSIS with shortcuts

**Context.** v0.1.0 shipped a one-click NSIS installer with no Desktop shortcut and no install-location choice.

**Decision.** Assisted installer (`oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`) with `createDesktopShortcut` and `createStartMenuShortcut`. Per-user install avoids a UAC prompt. Verified by silent-installing (`/S`) and asserting `Desktop\Lumen.lnk` exists.

## ADR-012 · Video adjustments within the HTML5 engine's limits

**Context.** Users expect YouTube-style resolution switching and an HDR toggle. Local single files have one encoded resolution and no alternate renditions, and Chromium's `<video>` exposes no API to force a lower *decode* resolution or to toggle true HDR passthrough per file.

**Decision.** Deliver what is genuinely controllable and honest:
- **Resolution** = a render *downscale* cap. The frame is rasterized at the chosen height then GPU-scaled to fit (`planRender` in `core/video.ts`), which really reduces composited pixels. Options are derived from the source: only tiers ≤ the file's height are offered (you can't add detail), so a 4K/1440p file exposes 1440p/1080p/720p… while a 1080p file caps at 1080p. Full per-file decode-resolution control waits for the libmpv engine (M4, `--vf=scale`).
- **HDR** = a tone/grade toggle (Auto / vivid / SDR) via CSS filters, plus display-capability detection. True HDR passthrough is an M4 libmpv capability.
- **Color** = brightness/contrast/saturation via CSS filter functions and gamma via a per-engine SVG `feComponentTransfer` filter — all real, composable, and live.

Filter-string building and resolution math are pure (`core/video.ts`) and unit-tested; the engine only applies their output.

**Consequences.** Honest, working controls today; no fake "1440p" on a 1080p file; a clear upgrade path where the same UI drives real decode-level scaling once libmpv lands.

## ADR-013 · mpv as a detected sidecar engine, not a bundled/native binding

**Context.** MKV/AVI/WMV/FLV/TS aren't demuxed by Chromium at all, and reliable HEVC + real HDR tone-mapping need a full media stack. The options were: (a) native libmpv bindings, (b) bundle mpv.exe in the installer, (c) detect an installed mpv and drive it.

libmpv bindings need node-gyp/MSVC — impossible on this machine (ADR-001). Bundling mpv adds ~100 MB and, critically, its native window compositing with the HTML UI could not be verified from the CI/VM environment — shipping unverified native-window rendering as a core install would violate the project's "verify before claiming done" rule.

**Decision.** Ship an mpv **sidecar engine** that Lumen detects (`src/main/mpv/locate.ts` candidate order: user path → bundled → common installs → PATH) and controls over JSON IPC (`src/main/mpv/protocol.ts`, newline-delimited JSON over a named pipe). mpv renders in its own GPU window with tuned args (`--hwdec=auto-safe --vo=gpu-next` + `--tone-mapping` per the HDR setting); Lumen's transport drives it via IPC and mirrors position/duration/eof back. Engine choice is pure and unit-tested (`core/engine/select.ts`): html5 for MP4/MOV/WebM, mpv for everything else, an actionable "install mpv" prompt when it's absent. No downloads performed by Lumen — the user installs mpv (one command via winget/scoop or mpv.io) and locates it once.

**Consequences.** Installer stays ~97 MB; no unverified native binary shipped; MKV/AVI/HEVC/HDR fully work for anyone with mpv; the protocol/selection/detection logic is verified by unit tests even though live rendering needs on-hardware confirmation. A future bundled-mpv or libmpv-embed path can slot in behind the same `select.ts`/IPC seam.

## ADR-009 · Product name: "Lumen"

Short, luminous, pairs with the light-focused brand accent (`#6c8cff`), unclaimed among major players; binary `lumen`, no spaces, works as protocol scheme `lumen://`.
