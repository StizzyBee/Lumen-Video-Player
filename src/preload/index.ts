import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LumenApi, Unsubscribe } from '@shared/lumen-api'

function on(channel: string, cb: (...args: never[]) => void): Unsubscribe {
  const handler = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: LumenApi = {
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    setFullscreen: (onFs) => ipcRenderer.send('win:set-fullscreen', onFs),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    setMiniMode: (onMini) => ipcRenderer.send('win:set-mini', onMini),
    setZoomFactor: (factor) => ipcRenderer.send('win:set-zoom', factor),
    onMaximized: (cb) => on('win:maximized', cb),
    onFullscreen: (cb) => on('win:fullscreen', cb)
  },
  library: {
    getState: () => ipcRenderer.invoke('library:get'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    removeFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
    rescan: () => ipcRenderer.invoke('library:rescan'),
    updateItem: (id, patch) => ipcRenderer.invoke('library:update-item', id, patch),
    addPaths: (paths) => ipcRenderer.invoke('library:add-paths', paths),
    openFileDialog: () => ipcRenderer.invoke('library:open-file-dialog'),
    onChanged: (cb) => on('library:changed', cb),
    onScanProgress: (cb) => on('library:scan-progress', cb)
  },
  media: {
    url: (path) => `lumen://media/?p=${encodeURIComponent(path)}`,
    readText: (path) => ipcRenderer.invoke('media:read-text', path),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  thumbs: {
    save: (id, jpegDataUrl) => ipcRenderer.invoke('thumbs:save', id, jpegDataUrl),
    url: (id) => `lumen://thumb/${id}`
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    patch: (patch) => ipcRenderer.invoke('settings:patch', patch),
    onChanged: (cb) => on('settings:changed', cb)
  },
  playlists: {
    list: () => ipcRenderer.invoke('playlists:list'),
    save: (p) => ipcRenderer.invoke('playlists:save', p),
    remove: (id) => ipcRenderer.invoke('playlists:remove', id)
  },
  shell: {
    showInFolder: (path) => ipcRenderer.send('shell:show-in-folder', path),
    saveScreenshot: (pngDataUrl, suggestedName) =>
      ipcRenderer.invoke('shell:save-screenshot', pngDataUrl, suggestedName)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    platform: 'win32',
    getOpenedFile: () => ipcRenderer.invoke('app:get-opened-file'),
    onOpenFile: (cb) => on('app:open-file', cb),
    setPlaying: (playing) => ipcRenderer.send('app:set-playing', playing)
  }
}

contextBridge.exposeInMainWorld('lumen', api)
