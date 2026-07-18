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

## ADR-009 · Product name: "Lumen"

Short, luminous, pairs with the light-focused brand accent (`#6c8cff`), unclaimed among major players; binary `lumen`, no spaces, works as protocol scheme `lumen://`.
