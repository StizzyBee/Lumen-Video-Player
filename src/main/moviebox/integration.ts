import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { MovieBoxIntegrationStatus } from '@shared/moviebox'
import {
  MOVIEBOX_BRIDGE_VERSION,
  MOVIEBOX_HARMONY_SHA256,
  MOVIEBOX_HARMONY_URL,
  MOVIEBOX_HOOK_SHA256,
  MOVIEBOX_HOOK_URL,
  movieBoxCandidates,
  movieBoxLaunchEnvironment
} from './integration-logic'

interface IntegrationConfig {
  schema: 1
  active: boolean
  movieBoxPath: string | null
}

const DEFAULT_CONFIG: IntegrationConfig = { schema: 1, active: false, movieBoxPath: null }

export class MovieBoxIntegration {
  private readonly installDir: string
  private readonly hookPath: string
  private readonly harmonyPath: string
  private readonly configPath: string

  constructor(
    userData: string,
    private readonly window: () => BrowserWindow
  ) {
    this.installDir = join(userData, 'integrations', 'moviebox')
    this.hookPath = join(this.installDir, 'MovieBoxPlayerMod.Hook.dll')
    this.harmonyPath = join(this.installDir, '0Harmony.dll')
    this.configPath = join(this.installDir, 'config.json')
  }

  async status(): Promise<MovieBoxIntegrationStatus> {
    const config = await this.readConfig()
    const filesReady = await this.bridgeFilesCurrent()
    const movieBoxPath = config.movieBoxPath && existsSync(config.movieBoxPath) ? config.movieBoxPath : null
    const shortcutsReady = this.shortcutPaths().every((path) => existsSync(path))
    return {
      active: !!config.active && filesReady && !!movieBoxPath && shortcutsReady,
      filesReady,
      shortcutsReady,
      movieBoxPath,
      bridgeVersion: MOVIEBOX_BRIDGE_VERSION,
      canActivate: process.platform === 'win32' && app.isPackaged
    }
  }

  async activate(): Promise<MovieBoxIntegrationStatus> {
    if (process.platform !== 'win32' || !app.isPackaged) throw new Error('moviebox-packaged-windows-only')
    await this.ensureBridgeFiles()
    const config = await this.readConfig()
    const movieBoxPath = await this.resolveMovieBoxPath(config.movieBoxPath)
    if (!movieBoxPath) throw new Error('moviebox-not-selected')
    await this.createShortcuts(movieBoxPath)
    await this.writeConfig({ schema: 1, active: true, movieBoxPath })
    return this.status()
  }

  async deactivate(): Promise<MovieBoxIntegrationStatus> {
    const config = await this.readConfig()
    for (const path of this.shortcutPaths()) {
      try { await fsp.rm(path, { force: true }) } catch { /* a locked shortcut is harmless */ }
    }
    await this.writeConfig({ ...config, active: false })
    return this.status()
  }

  async chooseMovieBox(): Promise<MovieBoxIntegrationStatus> {
    const selected = await this.pickMovieBox()
    if (!selected) return this.status()
    const config = await this.readConfig()
    await this.writeConfig({ ...config, movieBoxPath: selected })
    if (config.active && existsSync(this.hookPath) && existsSync(this.harmonyPath)) {
      await this.createShortcuts(selected)
    }
    return this.status()
  }

  async launch(): Promise<void> {
    const state = await this.status()
    if (!state.active || !state.movieBoxPath) throw new Error('moviebox-integration-not-active')
    const child = spawn(state.movieBoxPath, [], {
      cwd: dirname(state.movieBoxPath),
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
      env: movieBoxLaunchEnvironment(process.env, this.hookPath, process.execPath)
    })
    child.unref()
  }

  private async ensureBridgeFiles(): Promise<void> {
    if (await this.bridgeFilesCurrent()) return
    const [hook, harmony] = await Promise.all([
      this.downloadVerified(MOVIEBOX_HOOK_URL, MOVIEBOX_HOOK_SHA256, 512 * 1024),
      this.downloadVerified(MOVIEBOX_HARMONY_URL, MOVIEBOX_HARMONY_SHA256, 4 * 1024 * 1024)
    ])
    await fsp.mkdir(this.installDir, { recursive: true })
    const hookTemp = `${this.hookPath}.tmp`
    const harmonyTemp = `${this.harmonyPath}.tmp`
    await Promise.all([fsp.writeFile(hookTemp, hook), fsp.writeFile(harmonyTemp, harmony)])
    await Promise.all([fsp.rm(this.hookPath, { force: true }), fsp.rm(this.harmonyPath, { force: true })])
    await Promise.all([fsp.rename(hookTemp, this.hookPath), fsp.rename(harmonyTemp, this.harmonyPath)])
  }

  private async bridgeFilesCurrent(): Promise<boolean> {
    return (await Promise.all([
      this.fileMatches(this.hookPath, MOVIEBOX_HOOK_SHA256),
      this.fileMatches(this.harmonyPath, MOVIEBOX_HARMONY_SHA256)
    ])).every(Boolean)
  }

  private async fileMatches(path: string, expectedSha256: string): Promise<boolean> {
    try {
      const file = await fsp.readFile(path)
      return createHash('sha256').update(file).digest('hex') === expectedSha256
    } catch {
      return false
    }
  }

  private async downloadVerified(url: string, expectedSha256: string, maxBytes: number): Promise<Buffer> {
    const response = await net.fetch(url)
    if (!response.ok) throw new Error(`moviebox-bridge-download-${response.status}`)
    const file = Buffer.from(await response.arrayBuffer())
    if (file.length <= 0 || file.length > maxBytes) throw new Error('moviebox-bridge-size')
    const digest = createHash('sha256').update(file).digest('hex')
    if (digest !== expectedSha256) throw new Error('moviebox-bridge-integrity')
    return file
  }

  private async resolveMovieBoxPath(stored: string | null): Promise<string | null> {
    if (stored && existsSync(stored)) return stored
    const detected = movieBoxCandidates(process.env).find((path) => existsSync(path))
    return detected ?? this.pickMovieBox()
  }

  private async pickMovieBox(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window(), {
      title: 'Locate MovieBoxPro.exe',
      properties: ['openFile'],
      filters: [{ name: 'MovieBoxPro', extensions: ['exe'] }]
    })
    const selected = result.canceled ? null : result.filePaths[0] ?? null
    if (!selected || basename(selected).toLowerCase() !== 'movieboxpro.exe') return null
    return selected
  }

  private shortcutPaths(): string[] {
    return [
      join(app.getPath('desktop'), 'MovieBox with Lumen.lnk'),
      join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MovieBox with Lumen.lnk')
    ]
  }

  private async createShortcuts(movieBoxPath: string): Promise<void> {
    for (const path of this.shortcutPaths()) {
      await fsp.mkdir(dirname(path), { recursive: true })
      const written = shell.writeShortcutLink(path, 'create', {
        target: process.execPath,
        args: '--launch-moviebox',
        description: 'Launch MovieBox with playback redirected to Lumen',
        cwd: dirname(process.execPath),
        icon: movieBoxPath,
        iconIndex: 0
      })
      if (!written) throw new Error('moviebox-shortcut-failed')
    }
  }

  private async readConfig(): Promise<IntegrationConfig> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.configPath, 'utf8')) as Partial<IntegrationConfig>
      return {
        schema: 1,
        active: parsed.active === true,
        movieBoxPath: typeof parsed.movieBoxPath === 'string' ? parsed.movieBoxPath : null
      }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  private async writeConfig(config: IntegrationConfig): Promise<void> {
    await fsp.mkdir(this.installDir, { recursive: true })
    const temp = `${this.configPath}.tmp`
    await fsp.writeFile(temp, JSON.stringify(config, null, 2), 'utf8')
    await fsp.rename(temp, this.configPath)
  }
}
