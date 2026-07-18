# Lumen — agent notes

Modern Windows video player. Electron + Vite + React 19 + TypeScript, zustand, `motion`, lucide-react. No component library — hand-rolled Fluent-inspired design system on CSS custom properties.

## Commands

```bash
npm run dev        # Electron app with HMR (opens a window on the dev machine)
npm run dev:web    # renderer-only in a browser on :5199 with mock platform + demo data
npm run typecheck  # tsc for web + node configs (run before calling anything done)
npm test           # Vitest (pure-logic suites, no DOM env)
npm run build      # typecheck + electron-vite production build → out/
npm run dist       # build + electron-builder → release/ (NSIS installer exe)
npx electron scripts/make-samples.mjs  # regenerate sample WebMs into ~/Videos/Lumen Samples
```

## Architecture (read docs/ARCHITECTURE.md first)

- Three realms: `src/main` (Electron main), `src/preload` (typed bridge exposing `window.lumen`), `src/renderer` (React). Shared types/contract in `src/shared`.
- The renderer NEVER touches Electron directly — only `@/core/platform`, which falls back to `platform.mock.ts` in a plain browser. Keep every new privileged call flowing through `src/shared/lumen-api.ts` → preload → `src/main/ipc.ts`.
- Playback goes through the `PlaybackEngine` interface (`core/engine/`). UI must not reference `<video>` directly; a libmpv engine is planned (M4) behind the same interface.
- Media bytes stream over the custom `lumen://` protocol (Range support, path allowlist via `PathGuard`, CORS headers required — `crossOrigin` is set per-source in `core/media.ts`).
- All user actions are commands in `core/commands.ts`; shortcuts (`core/shortcuts.ts`) and the palette both dispatch through the registry. New features: register a command, don't wire ad-hoc key handlers.
- Persistence: versioned JSON stores with atomic writes (`src/main/store.ts`), merged over defaults via `mergeSettings` — never assume fields exist on disk.

## Gotchas

- Windows machine has **no MSVC/Rust toolchain** — no native Node modules (that's why JSON stores, not better-sqlite3). See docs/DECISIONS.md ADR-001/003.
- npm script chaining uses `&&` (cmd.exe semantics); PowerShell 5.1 itself does NOT support `&&`.
- Preload must stay CJS (`out/preload/index.cjs`) — sandboxed renderer requirement; main is ESM (use `import.meta.dirname`, not `__dirname`).
- The in-app Browser pane blocks third-party origins, so `dev:web` mock sample videos won't play there (they do in a normal browser). Playback verification: run the real app and check `%APPDATA%\Lumen\thumbs\*.jpg` get generated — thumbnails prove decode+protocol end-to-end.
- `tokens.css` is the design source of truth; components never hardcode colors/spacing/durations. Icons are lucide only.
