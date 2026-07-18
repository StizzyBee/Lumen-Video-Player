import { useRef, useState, type ReactNode } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX, Maximize, Minimize,
  Captions, Repeat, Repeat1, PictureInPicture2, GalleryVerticalEnd, MoreHorizontal,
  Camera, Activity, AudioLines, ListVideo, PanelRightClose, FilePlus2, RotateCcw, RotateCw, Bookmark
} from 'lucide-react'
import { usePlayer } from '@/core/store/player'
import { useLibrary } from '@/core/store/library'
import { useSettings } from '@/core/store/settings'
import { useUi } from '@/core/store/ui'
import { IconButton } from '@/components/ui/IconButton'
import { Slider } from '@/components/ui/Slider'
import { Menu, anchorFromElement, type MenuAnchor, type MenuEntry } from '@/components/ui/Menu'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Timeline } from './Timeline'
import { formatTime, formatRate } from '@/core/utils/format'
import styles from './ControlsBar.module.css'

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const NO_BOOKMARKS: number[] = []

type OpenMenu = 'subs' | 'speed' | 'audio' | 'more' | null

export function ControlsBar({ onMenuOpenChange }: { onMenuOpenChange: (open: boolean) => void }): ReactNode {
  const p = usePlayer()
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const ui = useUi()
  const mini = useUi((s) => s.miniMode)

  const [menu, setMenu] = useState<OpenMenu>(null)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const [speedDialog, setSpeedDialog] = useState(false)
  const [customSpeed, setCustomSpeed] = useState('1.00')
  const [remaining, setRemaining] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const openMenu = (which: Exclude<OpenMenu, null>) => (e: React.MouseEvent<HTMLButtonElement>) => {
    setAnchor(anchorFromElement(e.currentTarget, 'top'))
    setMenu(which)
    onMenuOpenChange(true)
  }
  const closeMenu = (): void => {
    setMenu(null)
    onMenuOpenChange(false)
  }

  const bookmarksRaw = useLibrary((s) => (p.item ? s.byId.get(p.item.id)?.bookmarks : undefined))
  const bookmarks = bookmarksRaw ?? NO_BOOKMARKS
  const playing = p.status === 'playing' || p.status === 'buffering'
  const audio = settings.audio
  const VolumeIcon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.5 ? Volume1 : Volume2

  const setVolume = (v: number): void => {
    patch({ audio: { volume: v, muted: false } })
    p.applyAudioSettings()
  }
  const toggleMute = (): void => {
    patch({ audio: { muted: !audio.muted } })
    p.applyAudioSettings()
  }

  const subsEntries: MenuEntry[] = [
    { type: 'header', label: 'Subtitles' },
    { id: 'off', label: 'Off', checked: p.activeSubId === null, onSelect: () => p.setActiveSub(null) },
    ...p.subTracks.map((t) => ({
      id: t.id,
      label: t.label,
      checked: p.activeSubId === t.id,
      onSelect: () => p.setActiveSub(t.id)
    })),
    { type: 'separator' },
    {
      id: 'add',
      label: 'Add subtitle file…',
      icon: <FilePlus2 size={16} />,
      onSelect: () => fileInput.current?.click()
    },
    { type: 'header', label: `Delay ${p.subDelayMs >= 0 ? '+' : ''}${(p.subDelayMs / 1000).toFixed(2)}s` },
    { id: 'delay-', label: 'Earlier (−250ms)', icon: <RotateCcw size={16} />, onSelect: () => p.nudgeSubDelay(-250) },
    { id: 'delay+', label: 'Later (+250ms)', icon: <RotateCw size={16} />, onSelect: () => p.nudgeSubDelay(250) }
  ]

  const speedEntries: MenuEntry[] = [
    { type: 'header', label: 'Playback speed' },
    ...SPEED_PRESETS.map((s) => ({
      id: String(s),
      label: formatRate(s),
      checked: Math.abs(p.rate - s) < 0.001,
      onSelect: () => p.setRate(s)
    })),
    { type: 'separator' },
    {
      id: 'custom',
      label: 'Custom…',
      onSelect: () => {
        setCustomSpeed(p.rate.toFixed(2))
        setSpeedDialog(true)
      }
    }
  ]

  const audioEntries: MenuEntry[] = [
    { type: 'header', label: 'Audio boost' },
    ...[1, 1.5, 2, 3].map((b) => ({
      id: `boost${b}`,
      label: b === 1 ? 'Off (100%)' : `${Math.round(b * 100)}%`,
      checked: Math.abs(audio.boost - b) < 0.01,
      onSelect: () => {
        patch({ audio: { boost: b } })
        p.applyAudioSettings()
      }
    })),
    { type: 'separator' },
    {
      id: 'normalize',
      label: 'Normalize volume',
      checked: audio.normalize,
      onSelect: () => {
        patch({ audio: { normalize: !audio.normalize } })
        p.applyAudioSettings()
      }
    },
    {
      id: 'eq',
      label: 'Equalizer',
      checked: audio.eqEnabled,
      onSelect: () => {
        patch({ audio: { eqEnabled: !audio.eqEnabled } })
        p.applyAudioSettings()
      }
    }
  ]

  const moreEntries: MenuEntry[] = [
    { id: 'shot', label: 'Save screenshot', icon: <Camera size={16} />, hint: 'Ctrl+Shift+S', onSelect: () => void p.screenshot() },
    { id: 'stats', label: p.statsVisible ? 'Hide stats' : 'Show stats', icon: <Activity size={16} />, hint: 'I', onSelect: () => p.toggleStats() },
    { id: 'ab', label: p.ab.a === null ? 'Set A point' : p.ab.b === null ? 'Set B point' : 'Clear A–B repeat', hint: 'Shift+R', onSelect: () => p.setAbPoint() },
    { id: 'bookmark', label: 'Bookmark this moment', icon: <Bookmark size={16} />, hint: 'B', onSelect: () => p.toggleBookmarkHere() },
    ...(bookmarks.length
      ? [
          { type: 'header', label: `Bookmarks · ${bookmarks.length}` } as const,
          ...bookmarks.map((b) => ({
            id: `bm-${b}`,
            label: `Jump to ${formatTime(b)}`,
            icon: <Bookmark size={16} />,
            onSelect: () => p.seekTo(b)
          }))
        ]
      : []),
    { type: 'separator' },
    { type: 'header', label: 'Video size' },
    ...([
      ['contain', 'Fit'],
      ['cover', 'Fill (crop)'],
      ['fill', 'Stretch'],
      ['none', 'Actual size']
    ] as const).map(([fit, label]) => ({
      id: `fit-${fit}`,
      label,
      checked: p.fit === fit,
      onSelect: () => p.setFit(fit)
    })),
    { type: 'separator' },
    { id: 'mini', label: 'Mini player', icon: <PanelRightClose size={16} />, hint: 'Ctrl+M', onSelect: () => ui.toggleMiniMode() }
  ]

  return (
    <div className={styles.bar} data-controls>
      <Timeline />
      <div className={styles.row}>
        <IconButton onVideo label={playing ? 'Pause' : 'Play'} kbd="Space" onClick={() => p.togglePlay()} size="lg">
          {playing ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
        </IconButton>

        {!mini && (
          <>
            <IconButton onVideo label="Previous" kbd="P" onClick={() => p.previous()}>
              <SkipBack size={19} />
            </IconButton>
            <IconButton onVideo label="Next" kbd="N" onClick={() => p.next()} disabled={p.queueIndex >= p.queue.length - 1}>
              <SkipForward size={19} />
            </IconButton>
          </>
        )}

        <div className={styles.volumeGroup}>
          <IconButton onVideo label={audio.muted ? 'Unmute' : 'Mute'} kbd="M" onClick={toggleMute}>
            <VolumeIcon size={19} />
          </IconButton>
          <div className={styles.volumeSlider}>
            <Slider
              ariaLabel="Volume"
              value={audio.muted ? 0 : audio.volume}
              min={0}
              max={1}
              step={0.01}
              onChange={setVolume}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </div>

        <button className={styles.time} onClick={() => setRemaining((r) => !r)} title="Toggle remaining time">
          {remaining && p.duration ? `−${formatTime(Math.max(0, p.duration - p.time))}` : formatTime(p.time)}
          <span className={styles.timeDim}>&nbsp;/&nbsp;{formatTime(p.duration)}</span>
        </button>

        <div className={styles.spacer} />

        {!mini && (
          <>
            <IconButton
              onVideo
              label="Subtitles"
              kbd="C"
              active={p.activeSubId !== null}
              onClick={openMenu('subs')}
            >
              <Captions size={20} />
            </IconButton>

            <IconButton onVideo label="Audio" active={audio.boost > 1 || audio.normalize || audio.eqEnabled} onClick={openMenu('audio')}>
              <AudioLines size={19} />
            </IconButton>

            <button
              className={`${styles.speedLabel} ${p.rate !== 1 ? styles.speedActive : ''}`}
              onClick={(e) => openMenu('speed')(e)}
              aria-label="Playback speed"
            >
              {formatRate(p.rate)}
            </button>

            <IconButton onVideo label="Loop" kbd="R" active={p.loop !== 'off'} onClick={() => p.cycleLoop()}>
              {p.loop === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
            </IconButton>

            <IconButton onVideo label="Queue" kbd="Ctrl+B" active={ui.playlistDrawerOpen} onClick={() => ui.setPlaylistDrawer(!ui.playlistDrawerOpen)}>
              <ListVideo size={19} />
            </IconButton>

            <IconButton onVideo label="Picture in picture" kbd="Alt+P" active={p.pipActive} onClick={() => p.togglePip()}>
              <PictureInPicture2 size={19} />
            </IconButton>

            <IconButton onVideo label="More" onClick={openMenu('more')}>
              <MoreHorizontal size={19} />
            </IconButton>
          </>
        )}

        {mini && (
          <IconButton onVideo label="Exit mini player" onClick={() => ui.toggleMiniMode()}>
            <GalleryVerticalEnd size={18} />
          </IconButton>
        )}

        <IconButton onVideo label={ui.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} kbd="F" onClick={() => ui.setFullscreen(!ui.fullscreen)}>
          {ui.fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
        </IconButton>
      </div>

      <Menu open={menu === 'subs'} anchor={anchor} entries={subsEntries} onClose={closeMenu} sticky minWidth={240} />
      <Menu open={menu === 'speed'} anchor={anchor} entries={speedEntries} onClose={closeMenu} minWidth={180} />
      <Menu open={menu === 'audio'} anchor={anchor} entries={audioEntries} onClose={closeMenu} sticky minWidth={220} />
      <Menu open={menu === 'more'} anchor={anchor} entries={moreEntries} onClose={closeMenu} minWidth={220} />

      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files
          if (!files) return
          for (const f of Array.from(files)) {
            const text = await f.text()
            p.addSubtitleFromText(f.name.replace(/\.(srt|vtt)$/i, ''), text)
          }
          e.target.value = ''
        }}
      />

      <Dialog
        open={speedDialog}
        title="Custom speed"
        onClose={() => setSpeedDialog(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setSpeedDialog(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const v = parseFloat(customSpeed)
                if (Number.isFinite(v) && v >= 0.1 && v <= 8) p.setRate(Math.round(v * 100) / 100)
                setSpeedDialog(false)
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        <div className={styles.customSpeed}>
          <input
            type="number"
            min={0.1}
            max={8}
            step={0.05}
            value={customSpeed}
            onChange={(e) => setCustomSpeed(e.target.value)}
            aria-label="Custom playback speed"
          />
          <div style={{ flex: 1 }}>
            <Slider
              ariaLabel="Custom speed"
              value={Number.isFinite(parseFloat(customSpeed)) ? parseFloat(customSpeed) : 1}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(v) => setCustomSpeed(v.toFixed(2))}
              format={formatRate}
            />
          </div>
        </div>
      </Dialog>
    </div>
  )
}
