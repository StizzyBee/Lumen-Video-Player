# Lumen — Design Language & UI Specification

The reference feel is **Fluent 2 × Discord × Apple TV**: calm surfaces, deep blacks, one confident accent, generous spacing, and motion that explains rather than decorates.

## 1. Principles

1. **The video is the interface.** Chrome recedes; when playing, everything auto-hides to zero.
2. **One accent, everywhere.** A single user-chosen accent drives focus, selection, progress, and identity.
3. **Depth over lines.** Hierarchy comes from elevation, blur, and tone — not borders.
4. **Motion is physics.** Short, spring-based, interruptible. Nothing teleports; nothing bounces for fun.
5. **Empty states are designed.** A first-run screen is a welcome, not an apology.

## 2. Design tokens

All styling flows from CSS custom properties in `src/renderer/src/design/tokens.css`. Components never hardcode values.

### Color system

Three themes share one semantic layer. Base surfaces (dark): `--bg` app background `#101014`, raised `#17171c`, overlay `#1e1e24`; OLED replaces the ladder with true `#000` + hairline strokes; light uses `#f5f5f7` / `#ffffff`. Text: `--text` 96%, `--text-2` 62%, `--text-3` 38% opacity steps. Accent defaults to `#6c8cff` ("Lumen Blue"); the user can pick any color — hover/active/soft variants are derived at runtime with `color-mix(in oklab, …)`, so *any* accent stays harmonious. Semantic: success `#3fb970`, warning `#f5a623`, danger `#f0525f`.

### Space, shape, elevation, type

- **Spacing**: 4px scale — `--sp-1..8` = 4, 8, 12, 16, 20, 24, 32, 48.
- **Radius**: `--r-sm` 6 (inputs), `--r-md` 10 (buttons, menus), `--r-lg` 14 (cards), `--r-xl` 20 (dialogs, hero).
- **Elevation**: soft ambient + directional key shadow pairs `--shadow-1..3`; overlays additionally use `backdrop-filter: blur(24px) saturate(1.4)` for acrylic.
- **Type**: `Segoe UI Variable` (system) → Display 28/600, Title 20/600, Subtitle 16/600, Body 14/400, Caption 12/400, Micro 11/500 uppercase tracking +0.4. Numerals in timestamps are `font-variant-numeric: tabular-nums`.

### Motion spec

| Token | Value | Used for |
| --- | --- | --- |
| `--t-fast` | 120ms `cubic-bezier(.2,0,0,1)` | hover states, icon swaps |
| `--t-med` | 200ms same | menus, popovers, toggle thumbs |
| `--t-slow` | 320ms `cubic-bezier(.16,1,.3,1)` | page transitions, dialogs, player chrome |
| springs | `motion` lib: `{ type:'spring', stiffness:520, damping:38 }` | cards, palette, panels |

Rules: animate only `transform`/`opacity`; page transitions = 12px slide + fade; hover lift = `translateY(-3px)` + shadow-2 + scale(1.02) on thumbnail; press = scale(0.97); everything respects `prefers-reduced-motion` and the in-app Reduced Motion setting.

### Iconography

`lucide` icons only, 20px in controls / 16px in menus, `stroke-width: 1.75`. Never mix icon families.

## 3. Wireframes

### App shell

```
┌──────────────────────────────────────────────────────────────┐
│ ◆ Lumen        ⌕ Search (Ctrl+K)              ─   ▢   ✕     │ ← custom titlebar, Mica, drag region
├──────────┬───────────────────────────────────────────────────┤
│  Home    │                                                   │
│  Library │                                                   │
│  Playlists                 <active view>                     │
│  Settings│                                                   │
│          │                                                   │
│  ────────│                                                   │
│  FOLDERS │                                                   │
│  ▸ Movies│                                                   │
│  ▸ Shows │                                                   │
└──────────┴───────────────────────────────────────────────────┘
   sidebar: 232px, collapsible to 64px icon rail; active item has
   an animated accent pill that slides between rows
```

### Home dashboard

```
┌───────────────────────────────────────────────────────────────┐
│  Continue watching                                            │
│  ┌───────────────────────────────┐ ┌─────────┐ ┌─────────┐   │
│  │   HERO: last unfinished       │ │ next    │ │ next    │   │
│  │   backdrop thumb, gradient    │ │ card    │ │ card    │   │
│  │   Title · 42 min left         │ └─────────┘ └─────────┘   │
│  │   [▶ Resume]  [↺ Start over]  │      ← progress bars on   │
│  │   ▓▓▓▓▓▓▓░░░░░ 63%            │        card bottoms       │
│  └───────────────────────────────┘                            │
│  Recently added                                    See all →  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   (scroll-snap    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    row, hover      │
│  Pinned              Favorites                 lift + play    │
│  ┌────┐ ┌────┐ …     ┌────┐ ┌────┐ …          glyph)          │
└───────────────────────────────────────────────────────────────┘
Empty state: centered glyph + "Your library is empty" + [Add a folder]
[Open a file] + full-window drag-and-drop target with animated dashed ring.
```

### Player (controls visible state)

```
┌───────────────────────────────────────────────────────────────┐
│ ‹ Back    Title of the video                    (fades w/ UI) │
│                                                               │
│                        VIDEO SURFACE                          │
│                                              [subtitles here] │
│                                                               │
│ ░░░░░░░░░░░░░░░ bottom gradient scrim ░░░░░░░░░░░░░░░░░░░░░░ │
│  ┌─ hover: thumbnail preview + timestamp ─┐                   │
│ ━━━━━━━━━━━━━━━━━━●─────────────  buffered ghost, chapter     │
│                                   ticks, bookmark dots        │
│ ▶ ⏮ ⏭  🔊──── 0:42:10 / 1:38:04   CC  ♪  1.0×  ⛶  ⧉  ⋯      │
└───────────────────────────────────────────────────────────────┘
Auto-hide: 2.8s idle → chrome fades/slides out, cursor hides.
Any mouse move / key press restores. Never hides while paused or
while a menu is open. Click video = play/pause; dbl-click = fullscreen.
```

### Library, Settings, Command palette

- **Library**: toolbar (view toggle grid/list · sort menu · filter chips · count) over a virtualized grid of `MediaCard`s (16:9 thumb, title, duration badge, resolution badge, progress bar, hover: lift + play button + quick actions ♥ 📌 ⋯). List view: dense rows with the same data. 
- **Settings**: category rail (Appearance, Playback, Subtitles, Shortcuts, Library, Privacy, About) + searchable flat index; every row is `SettingRow(label, description, control)`; subtitle section has a **live preview stage** rendering a sample cue over a still.
- **Command palette**: centered acrylic sheet, 560px, spring-in; input + fuzzy-ranked results with category chips and right-aligned kbd hints; `Ctrl+Shift+P` commands, `Ctrl+K` global search (files + commands + settings).

## 4. Component hierarchy

```
App
├─ TitleBar (drag region, search trigger, caption buttons)
├─ Sidebar (NavItem×n, FolderTree, CollapseToggle)
├─ ViewHost (AnimatePresence page transitions)
│  ├─ HomePage        → HeroCard, MediaRow(MediaCard×n)×4, EmptyLibrary
│  ├─ LibraryPage     → LibraryToolbar(SortMenu, ViewToggle, FilterChips),
│  │                    VirtualGrid(MediaCard) | MediaListRow×n
│  ├─ PlayerView      → VideoSurface(EngineHost, SubtitleLayer, PauseFlash),
│  │                    PlayerTopBar, ControlsBar(
│  │                      Timeline(HoverPreview, ChapterTicks, BookmarkDots),
│  │                      TransportButtons, VolumeControl, TimeReadout,
│  │                      TrackMenu, SpeedMenu, PlayerMenu),
│  │                    StatsOverlay, PlaylistDrawer
│  ├─ PlaylistsPage   → PlaylistList, PlaylistDetail(ReorderableList)
│  └─ SettingsPage    → SettingsNav, SettingsSearch, Section(SettingRow×n),
│                       AccentPicker, ThemePicker, SubtitlePreviewStage,
│                       ShortcutEditor(RecorderRow×n)
├─ CommandPalette
├─ ContextMenuHost · DialogHost · ToastHost
└─ DropOverlay (full-window drag & drop)

Primitives: Button, IconButton, Slider, Switch, Select, Tooltip, Menu,
Dialog, Toast, Skeleton, Badge, Kbd, SearchInput, EmptyState, ProgressBar
```

## 5. Input maps

**Keyboard (defaults, all rebindable)** — Space/K play-pause · J/L −10s/+10s · ←/→ −5s/+5s · ↑/↓ volume · M mute · F fullscreen · Esc exit/close · ,/. frame step · [/] speed − /+ · C subtitles · N/P next/prev · Ctrl+O open · Ctrl+K search · Ctrl+Shift+P palette · Ctrl+Shift+S screenshot · Ctrl+B playlist drawer · I stats overlay.

**Mouse** — click play/pause · double-click fullscreen · wheel volume (over video) · middle-click mute · hold-left ≥350ms = temporary 2× ("speed surf", releases on mouseup) · right-click Fluent context menu · hover bottom edge reveals controls.

## 6. Accessibility

Full keyboard reachability with visible `:focus-visible` rings (2px accent, 2px offset); roles/labels on every control; slider components implement the ARIA slider pattern; tooltips are supplementary, never the only label; High Contrast: honors `forced-colors` (tokens collapse to system colors); UI scale setting 90–150%; reduced-motion collapses all transitions to fades ≤80ms; subtitle renderer supports user font/size/contrast independent of any styling embedded in files.
