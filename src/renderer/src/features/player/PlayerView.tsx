import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft, Play, Pause, Volume2, VolumeX, FastForward, RotateCcw,
  FolderOpen, TriangleAlert, Camera, Activity, Repeat, X, MonitorPlay, Download
} from 'lucide-react'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { useUi } from '@/core/store/ui'
import { platform, isDesktop } from '@/core/platform'
import { HTML5_CONTAINERS } from '@/core/engine/select'
import { isStreamItem } from '@/core/streams'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { ControlsBar } from './ControlsBar'
import { SubtitleLayer } from './SubtitleLayer'
import { StatsOverlay } from './StatsOverlay'
import { PlaylistDrawer } from './PlaylistDrawer'
import styles from './PlayerView.module.css'

const HIDE_DELAY = 2800

export function PlayerView(): ReactNode {
  const p = usePlayer()
  const ui = useUi()
  const settings = useSettings((s) => s.settings)
  const patchSettings = useSettings((s) => s.patch)
  // mpv rendering inside Lumen's own window (vs mpv's separate window)
  const embeddedMpv = p.mpvMode === 'playing' && p.mpvEmbedded

  const [chromeVisible, setChromeVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hud, setHud] = useState<{ icon: ReactNode; text: string } | null>(null)
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const mpvSurfaceRef = useRef<HTMLDivElement | null>(null)
  const lastActivity = useRef(Date.now())
  const hudTimer = useRef(0)
  const holdTimer = useRef(0)
  const holdEngaged = useRef(false)
  const holdPrevRate = useRef(1)
  const suppressClick = useRef(false)
  const clickTimer = useRef(0)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  // ── engine host attach ──
  const attach = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el
    usePlayer.getState().attachHost(el)
  }, [])

  // ── auto-hide ──
  const poke = useCallback(() => {
    lastActivity.current = Date.now()
    setChromeVisible(true)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = usePlayer.getState()
      const uiS = useUi.getState()
      const busy =
        s.status !== 'playing' || menuOpen || uiS.playlistDrawerOpen || uiS.contextMenu !== null || uiS.paletteOpen
      if (!busy && Date.now() - lastActivity.current > HIDE_DELAY) setChromeVisible(false)
    }, 400)
    return () => window.clearInterval(t)
  }, [menuOpen])

  useEffect(() => {
    const onKey = (): void => poke()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poke])

  // Embedded mpv: mouse over the native surface never reaches the DOM, so
  // main watches the system cursor and pings us to revive the controls.
  useEffect(() => {
    if (!embeddedMpv) return
    return platform.mpv.onEvent((e) => {
      if (e.type === 'cursor') poke()
    })
  }, [embeddedMpv, poke])

  // Embedded mpv: continuously report the video region so main can lock MPV's
  // borderless render layer exactly inside Lumen's player UI.
  useEffect(() => {
    if (!embeddedMpv) return
    const el = mpvSurfaceRef.current
    if (!el) return
    const send = (): void => {
      const r = el.getBoundingClientRect()
      platform.mpv.setSurfaceRect({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        innerWidth: window.innerWidth
      })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    // Safety net for zoom/fullscreen settling that observers can miss
    const t = window.setInterval(send, 500)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      window.clearInterval(t)
    }
  }, [embeddedMpv])

  // ── HUD helper ──
  const showHud = useCallback((icon: ReactNode, text: string) => {
    setHud({ icon, text })
    window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => setHud(null), 1100)
  }, [])

  // volume/rate HUD reactions
  const prevVol = useRef(settings.audio.volume)
  const prevMuted = useRef(settings.audio.muted)
  useEffect(() => {
    if (settings.audio.volume !== prevVol.current || settings.audio.muted !== prevMuted.current) {
      prevVol.current = settings.audio.volume
      prevMuted.current = settings.audio.muted
      showHud(
        settings.audio.muted ? <VolumeX size={16} /> : <Volume2 size={16} />,
        settings.audio.muted ? 'Muted' : `${Math.round(settings.audio.volume * 100)}%`
      )
    }
  }, [settings.audio.volume, settings.audio.muted, showHud])

  const prevRate = useRef(p.rate)
  useEffect(() => {
    if (p.rate !== prevRate.current) {
      prevRate.current = p.rate
      if (!holdEngaged.current) showHud(<FastForward size={16} />, `${parseFloat(p.rate.toFixed(2))}×`)
    }
  }, [p.rate, showHud])

  // play/pause flash
  const prevStatus = useRef(p.status)
  useEffect(() => {
    const was = prevStatus.current
    prevStatus.current = p.status
    if (p.status === 'playing' && (was === 'paused' || was === 'ended')) {
      setFlash('play')
      window.setTimeout(() => setFlash(null), 500)
    } else if (p.status === 'paused' && was === 'playing') {
      setFlash('pause')
      window.setTimeout(() => setFlash(null), 500)
    }
  }, [p.status])

  // ── mouse gestures on the surface ──
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-controls], button, [role="menu"]')) return
    downPos.current = { x: e.clientX, y: e.clientY }
    holdEngaged.current = false
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      const s = usePlayer.getState()
      if (s.status !== 'playing') return
      holdEngaged.current = true
      holdPrevRate.current = s.rate
      s.setRate(2)
      showHud(<FastForward size={16} />, '2× speed')
    }, 380)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    poke()
    if (downPos.current) {
      const dx = e.clientX - downPos.current.x
      const dy = e.clientY - downPos.current.y
      if (dx * dx + dy * dy > 64) window.clearTimeout(holdTimer.current)
    }
  }
  const onPointerUp = (): void => {
    window.clearTimeout(holdTimer.current)
    downPos.current = null
    if (holdEngaged.current) {
      usePlayer.getState().setRate(holdPrevRate.current)
      holdEngaged.current = false
      suppressClick.current = true
      window.setTimeout(() => (suppressClick.current = false), 80)
      setHud(null)
    }
  }
  const onClick = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('[data-controls], button, [role="menu"]')) return
    if (suppressClick.current) return
    window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => p.togglePlay(), 220)
  }
  const onDoubleClick = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('[data-controls], button, [role="menu"]')) return
    window.clearTimeout(clickTimer.current)
    ui.setFullscreen(!ui.fullscreen)
  }
  const onWheel = (e: React.WheelEvent): void => {
    const delta = e.deltaY < 0 ? 0.05 : -0.05
    const volume = Math.round(Math.max(0, Math.min(1, settings.audio.volume + delta)) * 100) / 100
    patchSettings({ audio: { volume, muted: false } })
    p.applyAudioSettings()
    poke()
  }
  const onAuxClick = (e: React.MouseEvent): void => {
    if (e.button === 1) {
      patchSettings({ audio: { muted: !settings.audio.muted } })
      p.applyAudioSettings()
    }
  }
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    poke()
    const item = p.item
    ui.openContextMenu({ x: e.clientX, y: e.clientY }, [
      {
        id: 'toggle',
        label: p.status === 'playing' ? 'Pause' : 'Play',
        icon: p.status === 'playing' ? <Pause size={16} /> : <Play size={16} />,
        onSelect: () => p.togglePlay()
      },
      { id: 'restart', label: 'Restart', icon: <RotateCcw size={16} />, onSelect: () => p.seekTo(0) },
      { type: 'separator' },
      { id: 'shot', label: 'Save screenshot', icon: <Camera size={16} />, hint: 'Ctrl+Shift+S', onSelect: () => void p.screenshot() },
      { id: 'stats', label: p.statsVisible ? 'Hide stats' : 'Show stats', icon: <Activity size={16} />, hint: 'I', onSelect: () => p.toggleStats() },
      { id: 'loop', label: 'Cycle loop mode', icon: <Repeat size={16} />, hint: 'R', onSelect: () => p.cycleLoop() },
      { type: 'separator' },
      ...(p.mpvAvailable && p.mpvMode !== 'playing' && item
        ? [{ id: 'mpv', label: 'Play in mpv engine', icon: <MonitorPlay size={16} />, onSelect: () => p.playInMpv() } as const]
        : []),
      ...(isDesktop && item
        ? [{ id: 'reveal', label: 'Show in folder', icon: <FolderOpen size={16} />, onSelect: () => platform.shell.showInFolder(item.path) } as const]
        : []),
      { id: 'close', label: 'Close player', icon: <X size={16} />, hint: 'Esc', onSelect: () => p.close() }
    ])
  }

  const mini = ui.miniMode
  const showChrome = chromeVisible || p.status === 'paused' || p.status === 'ended' || p.status === 'error' || p.status === 'idle' || p.status === 'loading'
  // A file in one of Chromium's own containers that still needs mpv is a codec
  // problem (HEVC/10-bit/DTS), not a container problem — say so.
  const codecNeedsMpv = HTML5_CONTAINERS.has((p.item?.ext ?? '').toLowerCase())

  const errorCopy: Record<string, { title: string; desc: string }> = {
    unsupported: {
      title: 'This container needs the mpv engine',
      desc: `${p.item?.ext.toUpperCase() ?? 'This'} files (MKV, M2TS/MTS, VOB, MXF, AVI, WMV, FLV and more) aren't handled by the built-in engine. Install the mpv engine from Settings → Video to play them. MP4, MOV, M4V and WebM play natively when their codecs are available.`
    },
    decode: {
      title: 'Codec not supported here',
      desc: "This file's codec couldn't be decoded by the built-in engine. The mpv engine (Settings → Video) decodes it in software, including 10-bit HDR."
    },
    stall: {
      title: 'Playback stalled',
      desc: "The built-in engine couldn't keep decoding this file — usually an HEVC, 10-bit, or Dolby/DTS track. The mpv engine plays it in software."
    },
    network: { title: 'File unreadable', desc: 'The file could not be read. It may have moved, or the drive is unavailable.' },
    mpv: {
      title: 'This video could not be decoded',
      desc: 'The mpv engine stopped before playback completed. The file may be incomplete or damaged. Try downloading it again or test another copy.'
    },
    mpvEmbed: {
      title: 'Embedded playback could not start',
      desc: 'Lumen blocked mpv from opening a separate interface. Install or locate plain mpv.exe in Settings → Video, then try again.'
    }
  }

  return (
    <motion.div
      className={`${styles.view} ${showChrome ? '' : styles.chromeHidden} ${showChrome ? '' : styles.hideCursor}`}
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
    >
      <div className={styles.surface} ref={attach} />
      {p.mpvMode === 'off' && <SubtitleLayer />}

      {/* mpv embedded inside Lumen: the video region mpv renders into */}
      {embeddedMpv && (
        <div className={`${styles.mpvSurface} ${mini ? styles.mpvSurfaceMini : ''}`} ref={mpvSurfaceRef} />
      )}

      {/* mpv missing: setup prompt */}
      {p.mpvMode === 'needed' && (
        <div className={styles.mpvPanel}>
          <Download size={40} strokeWidth={1.5} />
          <div className={styles.mpvTitle}>
            {codecNeedsMpv ? 'This file needs the mpv engine to decode' : 'This file needs the mpv engine'}
          </div>
          <div className={styles.mpvDesc}>
            {p.item && isStreamItem(p.item) ? (
              <>
                Streaming from websites plays through mpv — it resolves the page with yt-dlp and renders right inside
                Lumen. Install mpv, then open the URL again.
              </>
            ) : codecNeedsMpv ? (
              <>
                This {p.item?.ext.toUpperCase()} uses a codec the built-in engine can&apos;t decode here — most likely
                HEVC/H.265, 10-bit video, or Dolby/DTS audio. mpv decodes all of them in software, with true HDR
                tone-mapping. Install mpv, then point Lumen at it.
              </>
            ) : (
              <>
                {p.item?.ext.toUpperCase()} files (MKV, M2TS/MTS, VOB, MXF, AVI, WMV, FLV and more) play through mpv — a free, open-source
                engine that also gives true HDR tone-mapping. Install mpv, then point Lumen at it.
              </>
            )}
          </div>
          {p.mpvInstalling ? (
            <div className={styles.installBox}>
              <div className={styles.installSpinner} />
              <div className={styles.installTitle}>Installing mpv…</div>
              <div className={styles.installLog}>{p.mpvInstallLog[p.mpvInstallLog.length - 1] ?? 'Starting…'}</div>
            </div>
          ) : (
            <>
              <div className={styles.installNote}>
                Lumen can install <strong>mpv</strong> for you (about 60&nbsp;MB) using Windows Package Manager — it
                plays right inside Lumen&apos;s window. You&apos;ll see the progress here — nothing installs without you.
              </div>
              <div className={styles.bigStateActions}>
                <Button variant="primary" icon={<Download size={16} />} onClick={() => void p.installMpv()}>
                  Install mpv automatically
                </Button>
                <Button variant="subtle" icon={<FolderOpen size={16} />} onClick={() => void p.locateMpv()}>
                  Locate existing mpv…
                </Button>
                <Button variant="ghost" onClick={() => p.close()}>Back</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* top bar */}
      {!mini && (
        <div className={`${styles.topBar} ${styles.chrome}`} data-controls>
          <IconButton onVideo size="lg" label="Back" kbd="Esc" onClick={() => p.close()}>
            <ChevronLeft size={26} />
          </IconButton>
          <div className={styles.topTitle}>{p.item?.title}</div>
        </div>
      )}

      {/* center transient states */}
      <div className={styles.center}>
        <AnimatePresence>
          {(p.status === 'loading' || p.status === 'buffering') && (
            <motion.div
              key="spin"
              className={styles.spinner}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.25 } }}
              exit={{ opacity: 0 }}
            />
          )}
          {flash && (
            <motion.div
              key={flash}
              className={styles.flash}
              initial={{ opacity: 0.9, scale: 0.7 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              {flash === 'play' ? <Play size={34} fill="currentColor" strokeWidth={0} /> : <Pause size={34} fill="currentColor" strokeWidth={0} />}
            </motion.div>
          )}
          {p.status === 'ended' && (
            <motion.div
              key="ended"
              className={styles.bigState}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className={styles.bigStateTitle}>That's the end</div>
              <div className={styles.bigStateActions}>
                <Button variant="primary" icon={<RotateCcw size={16} />} onClick={() => { p.seekTo(0); p.play() }}>
                  Replay
                </Button>
                <Button variant="subtle" onClick={() => p.close()}>
                  Back to library
                </Button>
              </div>
            </motion.div>
          )}
          {p.status === 'error' && p.mpvMode === 'off' && (
            <motion.div
              key="error"
              className={styles.bigState}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <TriangleAlert size={34} color="var(--warn)" />
              <div className={styles.bigStateTitle}>{errorCopy[p.errorKind ?? '']?.title ?? 'Playback failed'}</div>
              <div className={styles.bigStateDesc}>{errorCopy[p.errorKind ?? '']?.desc ?? 'Something went wrong while playing this file.'}</div>
              <div className={styles.bigStateActions}>
                {p.mpvAvailable && p.item && p.errorKind !== 'mpv' && (
                  <Button variant="primary" icon={<MonitorPlay size={16} />} onClick={() => p.playInMpv()}>
                    Play in mpv engine
                  </Button>
                )}
                {isDesktop && p.item && (
                  <Button variant="subtle" icon={<FolderOpen size={16} />} onClick={() => p.item && platform.shell.showInFolder(p.item.path)}>
                    Show in folder
                  </Button>
                )}
                <Button variant={p.mpvAvailable && p.errorKind !== 'mpv' ? 'ghost' : 'primary'} onClick={() => p.close()}>
                  Close
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* HUD chip */}
      <AnimatePresence>
        {hud && (
          <motion.div
            className={styles.hud}
            initial={{ opacity: 0, y: -8, x: '-50%', scale: 0.9 }}
            animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
            exit={{ opacity: 0, y: -6, x: '-50%', transition: { duration: 0.15 } }}
          >
            {hud.icon}
            {hud.text}
          </motion.div>
        )}
      </AnimatePresence>

      {p.statsVisible && <StatsOverlay />}

      <div className={styles.chrome}>
        <ControlsBar onMenuOpenChange={setMenuOpen} />
      </div>

      <AnimatePresence>{ui.playlistDrawerOpen && !mini && <PlaylistDrawer />}</AnimatePresence>
    </motion.div>
  )
}
