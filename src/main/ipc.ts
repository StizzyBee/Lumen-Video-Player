import { ipcMain, dialog, shell, app, powerSaveBlocker, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { Library } from './library'
import type { JsonStore } from './store'
import { mergeSettings, type Playlist, type Settings } from '@shared/types'
import type { DeepPartial } from '@shared/lumen-api'
import { pathGuard, mediaUrl } from './protocol'
import { setMiniMode } from './window'

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
