import { ipcMain, dialog, shell, app, powerSaveBlocker, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { Library } from './library'
import type { JsonStore } from './store'
import { mergeSettings, type Playlist, type Settings } from '@shared/types'
import type { DeepPartial } from '@shared/lumen-api'
import { pathGuard, mediaUrl } from './protocol'
import { setMiniMode } from './window'
import { MpvManager } from './mpv/manager'
import { hasWinget, installMpvViaWinget } from './mpv/install'

export interface IpcDeps {
  win: BrowserWindow
  library: Library
  settings: JsonStore<Settings>
  playlists: JsonStore<{ items: Playlist[] }>
  thumbsDir: string
  openedFile: string | null
}

export function registerIpc(deps: IpcDeps): void {
  const { library, settings, playlists, thumbsDir } = deps
  const win = (): BrowserWindow => deps.win

  // ── mpv sidecar engine (beta) ──────────────────────────────────────────────
  // Embedded-video surface: a frameless, non-focusable child window that mpv
  // renders INTO (--wid), positioned by the renderer so the video sits inside
  // Lumen's own player UI instead of mpv's separate window.
  type SurfaceRect = { x: number; y: number; width: number; height: number; innerWidth: number }
  let surface: BrowserWindow | null = null
  let lastRect: SurfaceRect | null = null

  const destroySurface = (): void => {
    if (surface && !surface.isDestroyed()) surface.destroy()
    surface = null
    lastRect = null
  }
  const createSurface = (): number | null => {
    destroySurface()
    try {
      const parent = win()
      surface = new BrowserWindow({
        parent,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        backgroundColor: '#000000',
        show: false
      })
      const b = parent.getContentBounds()
      surface.setBounds({ x: b.x, y: b.y + 42, width: b.width, height: Math.max(1, b.height - 42) })
      surface.showInactive()
      return Number(surface.getNativeWindowHandle().readBigUInt64LE())
    } catch {
      destroySurface()
      return null
    }
  }
  const positionSurface = (rect: SurfaceRect): void => {
    lastRect = rect
    if (!surface || surface.isDestroyed()) return
    const b = win().getContentBounds()
    const scale = rect.innerWidth > 0 ? b.width / rect.innerWidth : 1
    surface.setBounds({
      x: Math.round(b.x + rect.x * scale),
      y: Math.round(b.y + rect.y * scale),
      width: Math.max(1, Math.round(rect.width * scale)),
      height: Math.max(1, Math.round(rect.height * scale))
    })
  }
  const reposition = (): void => {
    if (lastRect) positionSurface(lastRect)
  }
  deps.win.on('move', reposition)
  deps.win.on('resize', reposition)

  const mpv = new MpvManager(
    (channel, payload) => {
      // mpv quit/exit → tear the embedded surface down with it
      if (channel === 'mpv:event' && (payload as { type?: string })?.type === 'exit') destroySurface()
      if (!win().isDestroyed()) win().webContents.send(channel, payload)
    },
    () => ({
      userPath: settings.get().video?.mpvPath || undefined,
      bundledPath: join(process.resourcesPath ?? '', 'mpv', 'mpv.exe'),
      pathEnv: process.env.PATH,
      localAppData: process.env.LOCALAPPDATA,
      programFiles: process.env['ProgramFiles'],
      programFilesX86: process.env['ProgramFiles(x86)']
    })
  )
  ipcMain.handle('mpv:detect', () => mpv.detect(true))
  ipcMain.handle('mpv:locate', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: 'Locate mpv.exe',
      properties: ['openFile'],
      filters: [{ name: 'mpv', extensions: ['exe'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const chosen = res.filePaths[0]
    settings.update((s) => ({ ...s, video: { ...s.video, mpvPath: chosen } }))
    return mpv.refresh()
  })
  ipcMain.handle('mpv:play', async (_e, path: string, opts) => {
    let wid: number | undefined
    if (opts?.embed) {
      const h = createSurface()
      if (h) wid = h
    }
    try {
      await mpv.load(path, { ...opts, wid })
      if (wid !== undefined) {
        // Embedding steals focus to mpv's surface; give it back to Lumen so the
        // keyboard shortcuts and control bar stay live.
        const w = win()
        if (!w.isDestroyed()) {
          w.focus()
          w.webContents.focus()
        }
      }
      return { embedded: wid !== undefined }
    } catch (e) {
      destroySurface()
      throw e
    }
  })
  ipcMain.on('mpv:surface-rect', (_e, rect: SurfaceRect) => {
    if (rect && typeof rect.width === 'number') positionSurface(rect)
  })
  ipcMain.on('mpv:play-pause', (_e, paused: boolean) => (paused ? mpv.pause() : mpv.play()))
  ipcMain.on('mpv:seek', (_e, sec: number) => mpv.seek(sec))
  ipcMain.on('mpv:set-rate', (_e, r: number) => mpv.setRate(r))
  ipcMain.on('mpv:set-volume', (_e, v: number) => mpv.setVolume(v))
  ipcMain.on('mpv:set-muted', (_e, m: boolean) => mpv.setMuted(m))
  ipcMain.on('mpv:set-audio-track', (_e, id: number) => mpv.setAudioTrack(id))
  ipcMain.on('mpv:set-sub-track', (_e, id: number | 'no') => mpv.setSubTrack(id))
  ipcMain.on('mpv:frame-step', (_e, dir: 1 | -1) => mpv.frameStep(dir))
  ipcMain.handle('mpv:has-winget', () => hasWinget())
  ipcMain.handle('mpv:install', async () => {
    const outcome = await installMpvViaWinget((line) => {
      if (!win().isDestroyed()) win().webContents.send('mpv:install-progress', line)
    })
    // Source of truth: did mpv actually land on disk? (winget returns non-zero
    // when the package was already present, which is still "ready".)
    const path = mpv.refresh()
    return { ok: !!path, path, reason: path ? undefined : outcome.reason ?? 'failed' }
  })
  ipcMain.handle('mpv:screenshot', async (_e, suggestedName: string) => {
    const res = await dialog.showSaveDialog(win(), {
      title: 'Save screenshot',
      defaultPath: join(
        app.getPath('pictures'),
        sanitize(typeof suggestedName === 'string' && suggestedName ? suggestedName : 'screenshot.png')
      ),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return null
    const target = res.filePath
    // Record the current mtime so we can confirm mpv actually (re)wrote the file.
    let before = -1
    try {
      before = (await fsp.stat(target)).mtimeMs
    } catch {
      /* new file — fine */
    }
    mpv.screenshot(target)
    // mpv writes asynchronously over the IPC pipe; wait until the file lands.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50))
      try {
        const st = await fsp.stat(target)
        if (st.size > 0 && st.mtimeMs !== before) return target
      } catch {
        /* not written yet */
      }
    }
    return null
  })
  ipcMain.on('mpv:stop', () => {
    mpv.stop()
    destroySurface()
  })

  // ── window ────────────────────────────────────────────────────────────────
  ipcMain.on('win:minimize', () => win().minimize())
  ipcMain.on('win:toggle-maximize', () => {
    const w = win()
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('win:close', () => win().close())
  ipcMain.on('win:set-fullscreen', (_e, on: boolean) => win().setFullScreen(!!on))
  ipcMain.handle('win:is-maximized', () => win().isMaximized())
  ipcMain.on('win:set-mini', (_e, on: boolean) => setMiniMode(win(), !!on))
  ipcMain.on('win:set-zoom', (_e, factor: number) => {
    if (typeof factor === 'number' && Number.isFinite(factor)) {
      win().webContents.setZoomFactor(Math.min(2, Math.max(0.5, factor)))
    }
  })

  // ── library ───────────────────────────────────────────────────────────────
  ipcMain.handle('library:get', () => library.state)
  ipcMain.handle('library:add-folder', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: 'Add a folder to your library',
      properties: ['openDirectory', 'dontAddToRecent']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return library.addFolder(res.filePaths[0])
  })
  ipcMain.handle('library:remove-folder', (_e, folder: string) => library.removeFolder(folder))
  ipcMain.handle('library:rescan', () => library.rescanAll())
  ipcMain.handle('library:update-item', (_e, id: string, patch: Record<string, unknown>) =>
    library.updateItem(id, patch)
  )
  ipcMain.handle('library:add-paths', (_e, paths: string[]) =>
    library.addPaths(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [])
  )
  ipcMain.handle('library:open-file-dialog', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: 'Open video files',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'ogv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled ? null : res.filePaths
  })

  // ── media / thumbs ────────────────────────────────────────────────────────
  ipcMain.handle('media:read-text', async (_e, path: string) => {
    if (typeof path !== 'string' || !pathGuard.isAllowed(path)) throw new Error('forbidden')
    return fsp.readFile(path, 'utf-8')
  })
  ipcMain.handle('thumbs:save', async (_e, id: string, dataUrl: string) => {
    if (!/^[a-f0-9]{16,64}$/.test(id)) throw new Error('bad id')
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
    if (!m) throw new Error('bad data url')
    await fsp.mkdir(thumbsDir, { recursive: true })
    await fsp.writeFile(join(thumbsDir, `${id}.jpg`), Buffer.from(m[1], 'base64'))
    library.updateItem(id, { thumbReady: true })
  })

  // ── settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:patch', (_e, patch: DeepPartial<Settings>) => {
    const merged = mergeSettings(deepMerge(settings.get(), patch))
    settings.set(merged)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', merged)
    return merged
  })

  // ── playlists ─────────────────────────────────────────────────────────────
  ipcMain.handle('playlists:list', () => playlists.get().items)
  ipcMain.handle('playlists:save', (_e, p: Playlist) => {
    playlists.update((cur) => {
      const idx = cur.items.findIndex((x) => x.id === p.id)
      const items = [...cur.items]
      if (idx >= 0) items[idx] = p
      else items.push(p)
      return { items }
    })
  })
  ipcMain.handle('playlists:remove', (_e, id: string) => {
    playlists.update((cur) => ({ items: cur.items.filter((x) => x.id !== id) }))
  })

  // ── shell / app ───────────────────────────────────────────────────────────
  ipcMain.on('shell:show-in-folder', (_e, path: string) => {
    if (typeof path === 'string' && pathGuard.isAllowed(path)) shell.showItemInFolder(path)
  })
  ipcMain.handle('shell:save-screenshot', async (_e, pngDataUrl: string, suggestedName: string) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(pngDataUrl)
    if (!m) throw new Error('bad data url')
    const res = await dialog.showSaveDialog(win(), {
      title: 'Save screenshot',
      defaultPath: join(app.getPath('pictures'), sanitize(suggestedName)),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return null
    await fsp.writeFile(res.filePath, Buffer.from(m[1], 'base64'))
    return res.filePath
  })
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:get-opened-file', () => deps.openedFile)

  let blockerId: number | null = null
  ipcMain.on('app:set-playing', (_e, playing: boolean) => {
    if (playing && blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else if (!playing && blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  })

  // convenience: precompute media urls in main if renderer asks (kept sync in preload instead)
  void mediaUrl
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : (patch as T))
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = (base as Record<string, unknown>)?.[k]
    out[k] = deepMerge(cur, v)
  }
  return out as T
}
