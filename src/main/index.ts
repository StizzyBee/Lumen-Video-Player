import { app } from 'electron'
import { join, isAbsolute, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { registerLumenScheme, installLumenProtocol, pathGuard } from './protocol'
import { createMainWindow } from './window'
import { Library } from './library'
import { JsonStore } from './store'
import { registerIpc } from './ipc'
import { mergeSettings, VIDEO_EXTENSIONS, type Playlist, type Settings } from '@shared/types'

app.setName('Lumen')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  registerLumenScheme()
  void bootstrap()
}

function fileArgFrom(argv: string[]): string | null {
  const exts = new Set<string>(VIDEO_EXTENSIONS)
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue
    const p = raw.replace(/^"|"$/g, '')
    if (isAbsolute(p) && exts.has(extname(p).slice(1).toLowerCase()) && existsSync(p)) return p
  }
  return null
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const thumbsDir = join(userData, 'thumbs')

  const settings = new JsonStore<Settings>(join(userData, 'settings.json'), mergeSettings(null))
  // Migrate forward: unknown fields dropped, missing fields defaulted
  settings.set(mergeSettings(settings.get()))

  const playlists = new JsonStore<{ items: Playlist[] }>(join(userData, 'playlists.json'), { items: [] })
  const library = new Library(userData)

  if (!settings.get().playback.hardwareDecoding) {
    app.disableHardwareAcceleration()
  }

  let openedFile = fileArgFrom(process.argv)
  if (openedFile) pathGuard.allowFileDir(openedFile)

  await app.whenReady()
  installLumenProtocol(thumbsDir)

  const win = createMainWindow(settings.get().theme.material)
  library.setBroadcast((channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
  library.startWatching()
  // First run: automatically index the Windows Videos folder
  void library.seedDefaultFolder(app.getPath('videos'))

  registerIpc({ win, library, settings, playlists, thumbsDir, openedFile })

  app.on('second-instance', (_e, argv) => {
    const file = fileArgFrom(argv)
    if (win.isMinimized()) win.restore()
    win.focus()
    if (file) {
      pathGuard.allowFileDir(file)
      void library.addPaths([file]).then(() => win.webContents.send('app:open-file', file))
    }
  })

  app.on('window-all-closed', () => {
    void Promise.all([library.flush(), settings.flush(), playlists.flush()]).finally(() => app.quit())
  })
}
