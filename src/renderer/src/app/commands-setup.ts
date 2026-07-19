// Registers every built-in command against the stores. Called once at boot.
import { registerCommands } from '@/core/commands'
import { platform } from '@/core/platform'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { useUi } from '@/core/store/ui'
import { useLibrary } from '@/core/store/library'

const player = (): ReturnType<typeof usePlayer.getState> => usePlayer.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()
const settings = (): ReturnType<typeof useSettings.getState> => useSettings.getState()

const inPlayer = (): boolean => player().item !== null

function adjustVolume(delta: number): void {
  const a = settings().settings.audio
  const volume = Math.round(Math.max(0, Math.min(1, a.volume + delta)) * 100) / 100
  settings().patch({ audio: { volume, muted: false } })
  player().applyAudioSettings()
}

function adjustRate(delta: number): void {
  const next = Math.round(Math.max(0.25, Math.min(4, player().rate + delta)) * 100) / 100
  player().setRate(next)
}

function leaveAndGo(view: Parameters<ReturnType<typeof useUi.getState>['navigate']>[0]): void {
  if (player().item) player().close()
  ui().navigate(view)
}

export function setupCommands(): void {
  registerCommands([
    // ── Playback ────────────────────────────────────────────────────────────
    { id: 'playback.toggle', title: 'Play / Pause', category: 'Playback', when: inPlayer, run: () => player().togglePlay() },
    { id: 'playback.toggleK', title: 'Play / Pause (K)', category: 'Playback', hidden: true, when: inPlayer, run: () => player().togglePlay() },
    { id: 'playback.seekBack', title: 'Seek backward', category: 'Playback', when: inPlayer, run: () => player().seekBy(-settings().settings.playback.seekSmallSec) },
    { id: 'playback.seekForward', title: 'Seek forward', category: 'Playback', when: inPlayer, run: () => player().seekBy(settings().settings.playback.seekSmallSec) },
    { id: 'playback.seekBackLarge', title: 'Seek back 10s', category: 'Playback', when: inPlayer, run: () => player().seekBy(-settings().settings.playback.seekLargeSec) },
    { id: 'playback.seekForwardLarge', title: 'Seek forward 10s', category: 'Playback', when: inPlayer, run: () => player().seekBy(settings().settings.playback.seekLargeSec) },
    { id: 'playback.volumeUp', title: 'Volume up', category: 'Playback', when: inPlayer, run: () => adjustVolume(0.05) },
    { id: 'playback.volumeDown', title: 'Volume down', category: 'Playback', when: inPlayer, run: () => adjustVolume(-0.05) },
    {
      id: 'playback.mute', title: 'Mute / Unmute', category: 'Playback', when: inPlayer,
      run: () => {
        settings().patch({ audio: { muted: !settings().settings.audio.muted } })
        player().applyAudioSettings()
      }
    },
    {
      id: 'playback.fullscreen', title: 'Toggle fullscreen', category: 'Playback', when: inPlayer,
      run: () => ui().setFullscreen(!ui().fullscreen)
    },
    { id: 'playback.speedUp', title: 'Speed up', category: 'Playback', when: inPlayer, run: () => adjustRate(0.25) },
    { id: 'playback.speedDown', title: 'Slow down', category: 'Playback', when: inPlayer, run: () => adjustRate(-0.25) },
    { id: 'playback.speedReset', title: 'Reset speed to 1×', category: 'Playback', when: inPlayer, run: () => player().setRate(1) },
    { id: 'playback.frameBack', title: 'Previous frame', category: 'Playback', when: inPlayer, run: () => player().frameStep(-1) },
    { id: 'playback.frameForward', title: 'Next frame', category: 'Playback', when: inPlayer, run: () => player().frameStep(1) },
    { id: 'playback.next', title: 'Next in queue', category: 'Playback', when: inPlayer, run: () => player().next() },
    { id: 'playback.previous', title: 'Previous / restart', category: 'Playback', when: inPlayer, run: () => player().previous() },
    { id: 'playback.loop', title: 'Cycle loop mode', category: 'Playback', when: inPlayer, run: () => player().cycleLoop() },
    { id: 'playback.abRepeat', title: 'A–B repeat: set point', category: 'Playback', when: inPlayer, run: () => player().setAbPoint() },
    { id: 'playback.bookmark', title: 'Add / remove bookmark here', category: 'Playback', when: inPlayer, run: () => player().toggleBookmarkHere() },
    { id: 'playback.stats', title: 'Toggle playback stats', category: 'Playback', when: inPlayer, run: () => player().toggleStats() },
    { id: 'playback.screenshot', title: 'Save screenshot', category: 'Playback', when: inPlayer, run: () => void player().screenshot() },
    { id: 'playback.pip', title: 'Picture in picture', category: 'Playback', when: inPlayer, run: () => player().togglePip() },
    { id: 'playback.miniPlayer', title: 'Toggle mini player', category: 'Playback', when: inPlayer, run: () => ui().toggleMiniMode() },
    {
      id: 'playback.playInMpv', title: 'Play in mpv engine', category: 'Playback',
      when: () => inPlayer() && player().mpvAvailable && player().mpvMode !== 'playing',
      run: () => player().playInMpv()
    },
    { id: 'playback.close', title: 'Close player', category: 'Playback', when: inPlayer, run: () => player().close() },

    // ── Subtitles ───────────────────────────────────────────────────────────
    {
      id: 'subtitles.cycle', title: 'Cycle subtitle track', category: 'Subtitles', when: inPlayer,
      run: () => {
        const p = player()
        const ids = [null, ...p.subTracks.map((t) => t.id)]
        const idx = ids.indexOf(p.activeSubId)
        const nextId = ids[(idx + 1) % ids.length]
        p.setActiveSub(nextId)
        ui().toast(
          { kind: 'info', title: nextId ? `Subtitles: ${p.subTracks.find((t) => t.id === nextId)?.label}` : 'Subtitles off' },
          1500
        )
      }
    },
    { id: 'subtitles.delayMinus', title: 'Subtitle delay −50ms', category: 'Subtitles', when: inPlayer, run: () => player().nudgeSubDelay(-50) },
    { id: 'subtitles.delayPlus', title: 'Subtitle delay +50ms', category: 'Subtitles', when: inPlayer, run: () => player().nudgeSubDelay(50) },

    // ── App ─────────────────────────────────────────────────────────────────
    {
      id: 'app.openFile', title: 'Open file…', category: 'App',
      run: async () => {
        const paths = await platform.library.openFileDialog()
        if (paths?.length) void player().openPaths(paths)
      }
    },
    { id: 'app.addFolder', title: 'Add folder to library…', category: 'Library', run: () => void useLibrary.getState().addFolder() },
    { id: 'app.rescan', title: 'Rescan library folders', category: 'Library', run: () => void useLibrary.getState().rescan() },
    { id: 'app.palette', title: 'Command palette', category: 'App', run: () => ui().setPaletteOpen(true, '>') },
    { id: 'app.search', title: 'Search everything', category: 'App', run: () => ui().setPaletteOpen(true, '') },
    { id: 'app.searchAlt', title: 'Search (Ctrl+F)', category: 'App', hidden: true, run: () => ui().setPaletteOpen(true, '') },
    { id: 'app.playlistDrawer', title: 'Toggle playlist panel', category: 'App', when: inPlayer, run: () => ui().setPlaylistDrawer(!ui().playlistDrawerOpen) },
    { id: 'app.settings', title: 'Open settings', category: 'App', run: () => ui().navigate({ name: 'settings' }) },
    {
      id: 'app.back', title: 'Back / dismiss', category: 'App', hidden: true,
      run: () => {
        const u = ui()
        if (u.contextMenu) return u.closeContextMenu()
        if (u.confirm) return u.closeConfirm()
        if (u.paletteOpen) return u.setPaletteOpen(false)
        if (u.playlistDrawerOpen) return u.setPlaylistDrawer(false)
        if (u.fullscreen) return u.setFullscreen(false)
        if (u.miniMode) return u.toggleMiniMode()
        if (u.view.name === 'player') return player().close()
        if (u.view.name === 'settings') return u.navigate(u.lastBrowseView)
      }
    },

    // ── Navigation & appearance ────────────────────────────────────────────
    { id: 'nav.home', title: 'Go to Home', category: 'Navigate', run: () => leaveAndGo({ name: 'home' }) },
    { id: 'nav.library', title: 'Go to Library', category: 'Navigate', run: () => leaveAndGo({ name: 'library' }) },
    { id: 'nav.playlists', title: 'Go to Playlists', category: 'Navigate', run: () => leaveAndGo({ name: 'playlists' }) },
    { id: 'theme.dark', title: 'Theme: Dark', category: 'Appearance', run: () => settings().patch({ theme: { mode: 'dark' } }) },
    { id: 'theme.light', title: 'Theme: Light', category: 'Appearance', run: () => settings().patch({ theme: { mode: 'light' } }) },
    { id: 'theme.oled', title: 'Theme: OLED Black', category: 'Appearance', run: () => settings().patch({ theme: { mode: 'oled' } }) },
    { id: 'theme.system', title: 'Theme: Sync with Windows', category: 'Appearance', run: () => settings().patch({ theme: { mode: 'system' } }) }
  ])
}
