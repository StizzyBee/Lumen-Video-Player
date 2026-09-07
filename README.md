# Lumen

**A luminous home for your videos.** Lumen is a modern Windows video player built around one idea: playing your files should feel as considered as the films themselves. Fluent-inspired design, smooth GPU-accelerated motion, a real library — not a gray box with a seek bar.

> Think "the VS Code of video players": clean, fast, customizable, and pleasant enough that you open it on purpose.

## Highlights

- **Home dashboard** — Continue Watching hero, Recent, Favorites, and folder collections with animated cards and thumbnails.
- **A player UI that gets out of the way** — auto-hiding controls, hover-preview timeline, inline speed/track/subtitle menus, stats overlay.
- **Themes** — Dark, Light, and OLED Black, with a custom accent system and automatic Windows theme sync. Mica window material on Windows 11.
- **Video controls** — switch render resolution (e.g. 1440p ↔ 1080p on higher-res files), an HDR/tone toggle, and full color grading (brightness, contrast, saturation, gamma) live during playback.
- **Broad format support** — H.264, HEVC/H.265, VP9 and AV1 in MP4/MOV/WebM play natively (HDR engages on HDR displays). MKV, M2TS/MTS, VOB, MXF, AVI, WMV, FLV, RealMedia and dozens of other containers play through the optional **mpv engine** — install [mpv](https://mpv.io/installation/) and point Lumen at it in Settings → Video.
- **Library** — your Windows Videos folder indexed automatically on first run, background scanning and watching, instant fuzzy search, grid/list views, resolution filters (4K · 1440p · 1080p · 720p · SD), sorting, favorites, tags.
- **Watch together** (`Ctrl+Shift+W`) — watch the same film with friends anywhere in the world, locked to the same frame. Either everyone plays their own copy, or one person shares theirs and the rest watch it straight from their PC — no copy needed. Drift is corrected by nudging the playback rate rather than seeking, so the audio never clicks or slips. Anyone can pause; the room can vote to resume, or to take pause and seek off someone for 5/10/60 minutes. NAT is handled with one-click ZeroTier or Tailscale setup from inside the app. See [docs/TOGETHER.md](docs/TOGETHER.md).
- **Command palette** (`Ctrl+Shift+P`) and fully customizable keyboard shortcuts.
- **Subtitle studio** — external SRT/VTT with live-styled rendering: font, size, color, outline, shadow, background, position, delay.
- **Private by design** — no telemetry, no ads, and no account. Your library and playback stay local; the packaged app only checks GitHub for an available update.

## Status

This repository is under active development. See [docs/ROADMAP.md](docs/ROADMAP.md) for the milestone plan and current status, and [docs/DECISIONS.md](docs/DECISIONS.md) for why things are built the way they are.

| Area | Status |
| --- | --- |
| App shell, theming, design system | ✅ Shipped |
| Playback (MP4/WebM/MOV, H.264/VP9/AV1 + HW decode) | ✅ Shipped |
| Library scan/watch, home dashboard, search | ✅ Shipped |
| Subtitles (external, styled), speed, loop, screenshots | ✅ Shipped |
| Command palette, shortcuts, settings, playlists | ✅ Shipped |
| Watch together (synchronized watch parties) | ✅ Shipped |
| Windows installer (`release/Lumen-Setup-0.4.2.exe`) | ✅ Shipped |
| Full-codec engine (mpv: MKV/HEVC/all formats) | ✅ Shipped |
| Clip export, GIF capture (ffmpeg) | 🔜 Planned (M5) |
| Plugin SDK | 🔜 Planned (M6) |

## Getting started

```bash
npm install
npm run dev          # launch the desktop app with hot reload
npm run dev:web      # UI-only in a browser with mock data (for UI work)
npm test             # unit tests (Vitest)
npm run build        # typecheck + production bundles
npm run dist         # package a Windows installer (electron-builder)
```

Requires Node 20+ on Windows 10/11.

## Install

Download **Lumen Setup x.y.z.exe** from the [latest release](https://github.com/StizzyBee/Lumen-Video-Player/releases/latest). The installer lets you pick the install location and creates Desktop and Start Menu shortcuts. It's unsigned, so Windows SmartScreen may warn on first run — choose *More info → Run anyway*.

## Repository map

```
src/
  main/       Electron main process: window, library scanner, settings, media protocol
  preload/    Typed context bridge (the `lumen` API surface)
  renderer/   React UI: design system, features, playback engines, stores
  shared/     Types + IPC contract shared by all three
server/       Optional standalone relay for watch parties (`npm run relay`)
docs/
  ARCHITECTURE.md   Process model, layers, IPC contract, plugin design
  TOGETHER.md       Watch parties: sync design, pause voting, reaching across NAT
  DESIGN.md         Design language, tokens, wireframes, component hierarchy
  ROADMAP.md        Milestones with acceptance criteria
  DECISIONS.md      Architecture Decision Records
```

## Privacy

Lumen has no telemetry, crash reporting, ads, or account. Your library index, thumbnails, settings, and playback history live in local app data and never leave your machine. The packaged app checks this repository for a newer release at startup; it never downloads or installs an update until you choose to.
