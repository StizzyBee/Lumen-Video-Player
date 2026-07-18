# Lumen

**A luminous home for your videos.** Lumen is a modern Windows video player built around one idea: playing your files should feel as considered as the films themselves. Fluent-inspired design, smooth GPU-accelerated motion, a real library — not a gray box with a seek bar.

> Think "the VS Code of video players": clean, fast, customizable, and pleasant enough that you open it on purpose.

## Highlights

- **Home dashboard** — Continue Watching hero, Recent, Favorites, and folder collections with animated cards and thumbnails.
- **A player UI that gets out of the way** — auto-hiding controls, hover-preview timeline, inline speed/track/subtitle menus, stats overlay.
- **Themes** — Dark, Light, and OLED Black, with a custom accent system and automatic Windows theme sync. Mica window material on Windows 11.
- **Library** — your Windows Videos folder indexed automatically on first run, background scanning and watching, instant fuzzy search, grid/list views, resolution filters (4K · 1440p · 1080p · 720p · SD), sorting, favorites, tags.
- **Command palette** (`Ctrl+Shift+P`) and fully customizable keyboard shortcuts.
- **Subtitle studio** — external SRT/VTT with live-styled rendering: font, size, color, outline, shadow, background, position, delay.
- **Private by design** — no telemetry, no ads, no account, fully offline.

## Status

This repository is under active development. See [docs/ROADMAP.md](docs/ROADMAP.md) for the milestone plan and current status, and [docs/DECISIONS.md](docs/DECISIONS.md) for why things are built the way they are.

| Area | Status |
| --- | --- |
| App shell, theming, design system | ✅ Shipped |
| Playback (MP4/WebM/MOV, H.264/VP9/AV1 + HW decode) | ✅ Shipped |
| Library scan/watch, home dashboard, search | ✅ Shipped |
| Subtitles (external, styled), speed, loop, screenshots | ✅ Shipped |
| Command palette, shortcuts, settings, playlists | ✅ Shipped |
| Windows installer (`release/Lumen Setup 0.1.0.exe`) | ✅ Shipped |
| Full-codec native engine (mpv: MKV/HEVC/all formats) | 🔜 Planned (M4) |
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

## Repository map

```
src/
  main/       Electron main process: window, library scanner, settings, media protocol
  preload/    Typed context bridge (the `lumen` API surface)
  renderer/   React UI: design system, features, playback engines, stores
  shared/     Types + IPC contract shared by all three
docs/
  ARCHITECTURE.md   Process model, layers, IPC contract, plugin design
  DESIGN.md         Design language, tokens, wireframes, component hierarchy
  ROADMAP.md        Milestones with acceptance criteria
  DECISIONS.md      Architecture Decision Records
```

## Privacy

Lumen makes **zero network requests** by default. There is no telemetry, no crash reporting, no update phone-home, no account. Your library index, thumbnails, and settings live in local app data and never leave your machine.
