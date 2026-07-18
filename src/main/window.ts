import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'

// ESM main process: __dirname is unavailable
const HERE = import.meta.dirname
import type { WindowMaterial } from '@shared/types'

const isWin11 = (() => {
  const build = parseInt(release().split('.')[2] ?? '0', 10)
  return process.platform === 'win32' && build >= 22000
})()

export interface MiniModeState {
  active: boolean
  prevBounds?: Electron.Rectangle
}

export const miniState: MiniModeState = { active: false }

export function createMainWindow(material: WindowMaterial): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 560,
    minHeight: 320,
    show: false,
    frame: false,
    backgroundColor: '#101014',
    ...(isWin11 && material !== 'solid' ? { backgroundMaterial: material } : {}),
    webPreferences: {
      preload: join(HERE, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // External links never navigate the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const send = (channel: string, ...args: unknown[]): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  win.on('maximize', () => send('win:maximized', true))
  win.on('unmaximize', () => send('win:maximized', false))
  win.on('enter-full-screen', () => send('win:fullscreen', true))
  win.on('leave-full-screen', () => send('win:fullscreen', false))

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(HERE, '../renderer/index.html'))
  }
  return win
}

export function setMiniMode(win: BrowserWindow, on: boolean): void {
  if (on === miniState.active) return
  if (on) {
    miniState.prevBounds = win.getBounds()
    miniState.active = true
    if (win.isMaximized()) win.unmaximize()
    win.setAlwaysOnTop(true, 'floating')
    win.setMinimumSize(280, 158)
    win.setAspectRatio(16 / 9)
    win.setBounds({ width: 480, height: 270 }, true)
  } else {
    miniState.active = false
    win.setAlwaysOnTop(false)
    win.setAspectRatio(0)
    win.setMinimumSize(560, 320)
    if (miniState.prevBounds) win.setBounds(miniState.prevBounds, true)
  }
}
