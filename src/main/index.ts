import { app, dialog } from 'electron'
import { join, isAbsolute, extname } from 'node:path'
import { appendFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { registerLumenScheme, installLumenProtocol, pathGuard } from './protocol'
import { createMainWindow } from './window'
import { Library } from './library'
import { JsonStore } from './store'
import { registerIpc } from './ipc'
import { needsCompatibilityRenderer } from './mpv/renderer'
import { mergeSettings, VIDEO_EXTENSIONS, type Playlist, type Settings } from '@shared/types'

app.setName('Lumen')

const startupTracePath = process.env['LUMEN_STARTUP_TRACE']
const startupTrace = (stage: string): void => {
  if (!startupTracePath) return
  try { appendFileSync(startupTracePath, `${Date.now()} ${stage}\n`) } catch { /* diagnostics only */ }
}

// Codec/HDR enablement (must run before app is ready).
//  • PlatformHEVCDecoderSupport — H.265/HEVC playback in MP4/MOV via the OS
//    decoder (hardware where available, Media Foundation software fallback).
//  • The HDR pipeline engages automatically on HDR-capable displays.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  startupTrace('single-instance lock denied')
  app.quit()
} else {
  startupTrace('single-instance lock acquired')
  registerLumenScheme()
  void bootstrap().catch((error) => {
    startupTrace(`bootstrap failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    console.error('[Lumen] startup failed', error)
    if (app.isReady()) {
      dialog.showErrorBox(
        'Lumen could not start',
        'Lumen could not open its local library data. Your video files were not changed. Please restart Lumen.'
      )
    }
    app.quit()
  })
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
  startupTrace('bootstrap started')
  const userData = app.getPath('userData')
  const thumbsDir = join(userData, 'thumbs')

  const settings = new JsonStore<Settings>(join(userData, 'settings.json'), mergeSettings(null))
  // Migrate forward: unknown fields dropped, missing fields defaulted
  settings.set(mergeSettings(settings.get()))

  const playlists = new JsonStore<{ items: Playlist[] }>(join(userData, 'playlists.json'), { items: [] })
  const library = new Library(userData)
  startupTrace('stores ready')

  if (!settings.get().playback.hardwareDecoding) {
    app.disableHardwareAcceleration()
  }

  let openedFile = fileArgFrom(process.argv)
  if (openedFile) pathGuard.allowFileDir(openedFile)

  await app.whenReady()
  startupTrace('app ready')
  installLumenProtocol(thumbsDir)

  let mpvCompatibilityRenderer = false
  const win = createMainWindow(settings.get().theme.material)
  startupTrace('main window created')
  const surfaceHostPath = app.isPackaged
    ? join(process.resourcesPath, 'surface', 'Lumen.SurfaceHost.exe')
    : join(app.getAppPath(), 'resources', 'surface', 'Lumen.SurfaceHost.exe')
  library.setBroadcast((channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
  library.startWatching()
  // First run: automatically index the Windows Videos folder
  void library.seedDefaultFolder(app.getPath('videos'))

  registerIpc({
    win,
    library,
    settings,
    playlists,
    thumbsDir,
    openedFile,
    mpvCompatibilityRenderer: () => mpvCompatibilityRenderer,
    surfaceHostPath
  })
  startupTrace('ipc registered')

  // Never hold the first window behind graphics detection. The registry check
  // completes in the background while the renderer loads and updates the mpv
  // mode before a user can begin playback.
  if (process.platform === 'win32') {
    execFile(
      'reg.exe',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Video', '/s', '/v', 'DriverDesc'],
      { windowsHide: true, encoding: 'utf8', timeout: 1000 },
      (_error, stdout) => {
        mpvCompatibilityRenderer = needsCompatibilityRenderer({ displayAdapters: stdout ?? '' })
        console.info(`[Lumen] mpv renderer: ${mpvCompatibilityRenderer ? 'OpenGL compatibility' : 'gpu-next'}`)
      }
    )
  }

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
