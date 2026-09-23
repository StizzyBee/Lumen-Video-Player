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
import { cleanupStaleUpdateCache } from './update-cleanup'
import { InstallationIdentityStore } from './identity'
import { MovieBoxBridgeClient, movieBoxLaunchArgs, movieBoxLaunchData } from './moviebox/bridge'
import { MovieBoxIntegration } from './moviebox/integration'

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

interface DeferredSecondInstance {
  argv: string[]
  additionalData: Record<string, unknown>
}

const initialMovieBoxLaunch = movieBoxLaunchArgs(process.argv, process.env)
const pendingSecondInstances: DeferredSecondInstance[] = []
let dispatchSecondInstance: ((launch: DeferredSecondInstance) => void) | null = null
const gotLock = app.requestSingleInstanceLock(
  initialMovieBoxLaunch ? { movieBox: initialMovieBoxLaunch } : {}
)
if (!gotLock) {
  startupTrace('single-instance lock denied')
  app.quit()
} else {
  // Register this before bootstrap so a bridge launch cannot be lost while
  // the primary instance is still opening its library and renderer.
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const launch: DeferredSecondInstance = {
      argv,
      additionalData: additionalData && typeof additionalData === 'object'
        ? additionalData as Record<string, unknown>
        : {}
    }
    if (dispatchSecondInstance) dispatchSecondInstance(launch)
    else pendingSecondInstances.push(launch)
  })
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
  void cleanupStaleUpdateCache(app.getVersion(), process.env.LOCALAPPDATA)
  const userData = app.getPath('userData')
  const thumbsDir = join(userData, 'thumbs')

  const settings = new JsonStore<Settings>(join(userData, 'settings.json'), mergeSettings(null))
  // Keep install identity separate from preferences. Updates replace binaries,
  // not userData, so the private key and assigned LMN number survive upgrades.
  const migratedSettings = mergeSettings(settings.get())
  const identity = new InstallationIdentityStore(
    join(userData, 'identity.json'),
    migratedSettings.together.memberId
  )
  migratedSettings.together.memberId = identity.get().memberId
  settings.set(migratedSettings)
  await identity.flush()

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
  const movieBox = new MovieBoxBridgeClient((event) => {
    if (win.isDestroyed()) return
    if (event.type === 'connected') {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
      win.webContents.focus()
    }
    win.webContents.send('moviebox:event', event)
  })
  const movieBoxIntegration = new MovieBoxIntegration(userData, () => win)
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
    surfaceHostPath,
    identity,
    movieBox,
    movieBoxIntegration
  })
  startupTrace('ipc registered')

  if (initialMovieBoxLaunch) movieBox.connect(initialMovieBoxLaunch)
  if (process.argv.includes('--launch-moviebox')) {
    void movieBoxIntegration.launch().catch((error) => {
      dialog.showErrorBox('MovieBox bridge', error instanceof Error ? error.message : String(error))
    })
  }

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
        console.info(`[Lumen] mpv renderer: ${mpvCompatibilityRenderer ? 'Direct3D compatibility' : 'gpu-next'}`)
      }
    )
  }

  dispatchSecondInstance = ({ argv, additionalData }): void => {
    const file = fileArgFrom(argv)
    const movieBoxArgs = movieBoxLaunchData(additionalData.movieBox) ?? movieBoxLaunchArgs(argv)
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    if (movieBoxArgs) movieBox.connect(movieBoxArgs)
    if (argv.includes('--launch-moviebox')) {
      void movieBoxIntegration.launch().catch((error) => {
        dialog.showErrorBox('MovieBox bridge', error instanceof Error ? error.message : String(error))
      })
    }
    if (file) {
      pathGuard.allowFileDir(file)
      void library.addPaths([file]).then(() => win.webContents.send('app:open-file', file))
    }
  }
  for (const launch of pendingSecondInstances.splice(0)) dispatchSecondInstance(launch)

  app.on('window-all-closed', () => {
    movieBox.stop()
    void Promise.all([library.flush(), settings.flush(), playlists.flush()]).finally(() => app.quit())
  })
}
