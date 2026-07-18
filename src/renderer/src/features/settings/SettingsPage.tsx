import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Palette, Play, AudioLines, Captions, Keyboard, FolderCog, ShieldCheck,
  FolderPlus, Trash2, RefreshCw, RotateCcw, MonitorCog
} from 'lucide-react'
import { availableResolutions, DEFAULT_COLOR } from '@/core/video'
import type { ColorAdjust } from '@shared/types'
import { useSettings } from '@/core/store/settings'
import { useLibrary } from '@/core/store/library'
import { useUi } from '@/core/store/ui'
import { usePlayer } from '@/core/store/player'
import { platform, isDesktop } from '@/core/platform'
import { Switch } from '@/components/ui/Switch'
import { Slider } from '@/components/ui/Slider'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput, Kbd } from '@/components/ui/bits'
import { Menu, anchorFromElement, type MenuAnchor } from '@/components/ui/Menu'
import { allCommands } from '@/core/commands'
import { DEFAULT_KEYMAP, bindingFromEvent, findConflicts, formatBinding } from '@/core/shortcuts'
import { formatRate } from '@/core/utils/format'
import styles from './SettingsPage.module.css'

const ACCENTS = ['#6c8cff', '#8b7cf6', '#e85d75', '#f06292', '#e8823d', '#e5b93c', '#3fb970', '#38b6c9']
const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Consolas']

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'playback', label: 'Playback', icon: <Play size={16} /> },
  { id: 'video', label: 'Video', icon: <MonitorCog size={16} /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={16} /> },
  { id: 'subtitles', label: 'Subtitles', icon: <Captions size={16} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} /> },
  { id: 'library', label: 'Library', icon: <FolderCog size={16} /> },
  { id: 'privacy', label: 'Privacy & About', icon: <ShieldCheck size={16} /> }
] as const

function Row({
  label,
  desc,
  children,
  wide,
  query
}: {
  label: string
  desc?: string
  children: ReactNode
  wide?: boolean
  query: string
}): ReactNode {
  if (query && !(label + ' ' + (desc ?? '')).toLowerCase().includes(query.toLowerCase())) return null
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {desc ? <div className={styles.rowDesc}>{desc}</div> : null}
      </div>
      <div className={`${styles.rowControl} ${wide ? styles.wide : ''}`}>{children}</div>
    </div>
  )
}

function Section({
  id,
  label,
  icon,
  children
}: {
  id: string
  label: string
  icon: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section id={`settings-${id}`} className={styles.section} aria-label={label}>
      <h2 className={styles.sectionTitle}>
        {icon}
        {label}
      </h2>
      <div className={styles.card}>{children}</div>
    </section>
  )
}

function ThemePicker(): ReactNode {
  const mode = useSettings((s) => s.settings.theme.mode)
  const patch = useSettings((s) => s.patch)
  const options = [
    { id: 'system', name: 'Windows', surfaces: ['#0f0f13', '#f2f2f6'] },
    { id: 'dark', name: 'Dark', surfaces: ['#0f0f13', '#16161c'] },
    { id: 'light', name: 'Light', surfaces: ['#f2f2f6', '#ffffff'] },
    { id: 'oled', name: 'OLED Black', surfaces: ['#000000', '#0a0a0e'] }
  ] as const
  return (
    <div className={styles.themeGrid} role="radiogroup" aria-label="Theme">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={mode === o.id}
          className={`${styles.themeCard} ${mode === o.id ? styles.on : ''}`}
          onClick={() => patch({ theme: { mode: o.id } })}
        >
          <div className={styles.themePreview} style={{ background: o.surfaces[0] }}>
            <div style={{ flex: 1, borderRadius: 6, background: o.surfaces[1], boxShadow: 'inset 0 0 0 1px rgba(128,128,160,.25)' }} />
            <div style={{ flex: 2, borderRadius: 6, background: o.surfaces[1], boxShadow: 'inset 0 0 0 1px rgba(128,128,160,.25)', display: 'flex', alignItems: 'flex-end', padding: 5 }}>
              <div style={{ height: 4, width: '60%', borderRadius: 4, background: 'var(--accent)' }} />
            </div>
          </div>
          <div className={styles.themeName}>{o.name}</div>
        </button>
      ))}
    </div>
  )
}

function AccentPicker(): ReactNode {
  const accent = useSettings((s) => s.settings.theme.accent)
  const patch = useSettings((s) => s.patch)
  return (
    <div className={styles.accentRow} role="radiogroup" aria-label="Accent color">
      {ACCENTS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={accent.toLowerCase() === c}
          aria-label={`Accent ${c}`}
          className={`${styles.swatch} ${accent.toLowerCase() === c ? styles.on : ''}`}
          style={{ background: c }}
          onClick={() => patch({ theme: { accent: c } })}
        />
      ))}
      <label className={styles.customSwatch} title="Custom color">
        <input
          type="color"
          value={accent}
          onChange={(e) => patch({ theme: { accent: e.target.value } })}
          aria-label="Custom accent color"
        />
      </label>
    </div>
  )
}

function Equalizer(): ReactNode {
  const audio = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  const apply = usePlayer((s) => s.applyAudioSettings)
  const freqs = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']
  const set = (i: number, v: number): void => {
    const eq = [...audio.eq]
    eq[i] = v
    patch({ audio: { eq } })
    apply()
  }
  return (
    <div>
      <div className={styles.eq}>
        {freqs.map((f, i) => (
          <div key={f} className={styles.eqBand}>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={audio.eq[i] ?? 0}
              onChange={(e) => set(i, parseInt(e.target.value, 10))}
              aria-label={`${f}Hz`}
              disabled={!audio.eqEnabled}
              style={{ opacity: audio.eqEnabled ? 1 : 0.35 }}
            />
            <span className={styles.eqFreq}>{f}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            patch({ audio: { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } })
            apply()
          }}
        >
          Reset bands
        </Button>
      </div>
    </div>
  )
}

function SubtitlePreview(): ReactNode {
  const style = useSettings((s) => s.settings.subtitles.style)
  const textShadow = [
    style.outline ? '0 0 2px rgba(0,0,0,.95), 1.5px 1.5px 0 rgba(0,0,0,.85), -1.5px 1.5px 0 rgba(0,0,0,.85), 1.5px -1.5px 0 rgba(0,0,0,.85), -1.5px -1.5px 0 rgba(0,0,0,.85)' : '',
    style.shadow ? '0 3px 10px rgba(0,0,0,.8)' : ''
  ].filter(Boolean).join(', ')
  return (
    <div className={styles.subPreview} aria-hidden>
      <div
        style={{
          position: 'absolute',
          left: '6%',
          right: '6%',
          bottom: `${style.bottomPct}%`,
          textAlign: 'center'
        }}
      >
        <span
          style={{
            fontFamily: `'${style.fontFamily}', sans-serif`,
            fontSize: `${style.sizePct * 0.55}cqw`,
            fontWeight: style.bold ? 700 : 500,
            color: style.color,
            textShadow: textShadow || undefined,
            background: style.bgOpacity > 0 ? `rgba(0,0,0,${style.bgOpacity})` : 'transparent',
            padding: style.bgOpacity > 0 ? '0.15em 0.5em' : 0,
            borderRadius: 8,
            lineHeight: 1.35,
            display: 'inline-block'
          }}
        >
          Every frame deserves a beautiful caption.
        </span>
      </div>
    </div>
  )
}

function ShortcutsEditor({ query }: { query: string }): ReactNode {
  const overrides = useSettings((s) => s.settings.shortcuts)
  const patch = useSettings((s) => s.patch)
  const toast = useUi((s) => s.toast)
  const [recording, setRecording] = useState<string | null>(null)
  const recRef = useRef<string | null>(null)
  recRef.current = recording

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const id = recRef.current
      if (!id) return
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      if (e.key === 'Backspace') {
        patch({ shortcuts: { ...useSettings.getState().settings.shortcuts, [id]: '' } })
        setRecording(null)
        return
      }
      const binding = bindingFromEvent(e)
      if (!binding) return
      const conflicts = findConflicts(binding, id, useSettings.getState().settings.shortcuts)
      patch({ shortcuts: { ...useSettings.getState().settings.shortcuts, [id]: binding } })
      if (conflicts.length) {
        const names = conflicts
          .map((c) => allCommands().find((x) => x.id === c)?.title ?? c)
          .join(', ')
        toast({ kind: 'warn', title: 'Shortcut conflict', desc: `${formatBinding(binding)} was taken from: ${names}` })
      }
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, patch, toast])

  const commands = allCommands()
    .filter((c) => !c.hidden || DEFAULT_KEYMAP[c.id])
    .filter((c) => !query || c.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))

  return (
    <div>
      {commands.map((c) => {
        const binding = overrides[c.id] !== undefined ? overrides[c.id] : DEFAULT_KEYMAP[c.id]
        const isCustom = overrides[c.id] !== undefined && overrides[c.id] !== DEFAULT_KEYMAP[c.id]
        return (
          <div key={c.id} className={styles.shortcutRow}>
            <span className={styles.shortcutCat}>{c.category}</span>
            <span className={styles.shortcutLabel}>{c.title}</span>
            {isCustom && (
              <IconButton
                size="sm"
                label="Reset to default"
                onClick={() => {
                  const next = { ...useSettings.getState().settings.shortcuts }
                  delete next[c.id]
                  patch({ shortcuts: next })
                }}
              >
                <RotateCcw size={13} />
              </IconButton>
            )}
            <button
              className={`${styles.bindingBtn} ${recording === c.id ? styles.recording : ''}`}
              onClick={() => setRecording(recording === c.id ? null : c.id)}
            >
              {recording === c.id ? 'Press keys… (Esc cancels)' : binding ? formatBinding(binding) : 'Not bound'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function LibraryFolders(): ReactNode {
  const folders = useLibrary((s) => s.folders)
  const addFolder = useLibrary((s) => s.addFolder)
  const removeFolder = useLibrary((s) => s.removeFolder)
  const rescan = useLibrary((s) => s.rescan)
  const askConfirm = useUi((s) => s.askConfirm)
  return (
    <div>
      {folders.map((f) => (
        <div key={f} className={styles.folderRow}>
          <span className={styles.folderPath} title={f}>{f}</span>
          <IconButton
            size="sm"
            label="Remove folder from library"
            onClick={() =>
              askConfirm({
                title: 'Remove folder?',
                body: `“${f}” will be removed from your library. Files on disk are never touched.`,
                confirmLabel: 'Remove',
                danger: true,
                onConfirm: () => void removeFolder(f)
              })
            }
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <div className={styles.folderRow} style={{ gap: 8 }}>
        <Button size="sm" variant="subtle" icon={<FolderPlus size={14} />} onClick={() => void addFolder()}>
          Add folder
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void rescan()}>
          Rescan all
        </Button>
      </div>
    </div>
  )
}

export function SettingsPage(): ReactNode {
  const view = useUi((s) => s.view)
  const s = useSettings((st) => st.settings)
  const patch = useSettings((st) => st.patch)
  const apply = usePlayer((st) => st.applyAudioSettings)
  const applyVideo = usePlayer((st) => st.applyVideoSettings)
  const mpvAvailable = usePlayer((st) => st.mpvAvailable)
  const locateMpv = usePlayer((st) => st.locateMpv)
  const [query, setQuery] = useState('')
  const [fontMenu, setFontMenu] = useState<MenuAnchor | null>(null)
  const [version, setVersion] = useState('')
  const [hdrDisplay, setHdrDisplay] = useState(false)

  useEffect(() => {
    void platform.app.version().then(setVersion)
    setHdrDisplay(window.matchMedia?.('(dynamic-range: high)')?.matches ?? false)
  }, [])

  useEffect(() => {
    if (view.name === 'settings' && view.section) {
      document.getElementById(`settings-${view.section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [view])

  const sub = s.subtitles.style
  const q = query

  const jump = (id: string): void =>
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className={styles.page}>
      <div className={styles.rail}>
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search settings" wrapStyle={{ marginBottom: 8 }} />
        {SECTIONS.map((sec) => (
          <button key={sec.id} className={styles.railItem} onClick={() => jump(sec.id)}>
            {sec.icon}
            {sec.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        <h1 className={styles.pageTitle}>Settings</h1>

        <Section id="appearance" label="Appearance" icon={<Palette size={16} />}>
          {!q && (
            <div className={styles.rowBlock}>
              <div className={styles.rowLabel} style={{ marginBottom: 10 }}>Theme</div>
              <ThemePicker />
            </div>
          )}
          {!q && (
            <div className={styles.rowBlock}>
              <div className={styles.rowLabel} style={{ marginBottom: 10 }}>Accent color</div>
              <AccentPicker />
            </div>
          )}
          <Row query={q} label="Window material" desc="Mica lets the desktop subtly tint the window (Windows 11)">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['mica', 'acrylic', 'solid'] as const).map((m) => (
                <Button key={m} size="sm" variant={s.theme.material === m ? 'accentSoft' : 'ghost'} onClick={() => patch({ theme: { material: m } })}>
                  {m[0].toUpperCase() + m.slice(1)}
                </Button>
              ))}
            </div>
          </Row>
          <Row query={q} label="Interface scale" desc="Scales the whole app" wide>
            <Slider ariaLabel="Interface scale" value={s.ui.scale} min={0.9} max={1.5} step={0.05} onChange={(v) => patch({ ui: { scale: Math.round(v * 100) / 100 } })} />
            <span className={styles.sliderValue}>{Math.round(s.ui.scale * 100)}%</span>
          </Row>
          <Row query={q} label="Reduced motion" desc="Collapse animations to quick fades">
            <Switch ariaLabel="Reduced motion" checked={s.ui.reducedMotion} onChange={(v) => patch({ ui: { reducedMotion: v } })} />
          </Row>
        </Section>

        <Section id="playback" label="Playback" icon={<Play size={16} />}>
          <Row query={q} label="Remember position" desc="Resume videos where you left off">
            <Switch ariaLabel="Remember position" checked={s.playback.rememberPosition} onChange={(v) => patch({ playback: { rememberPosition: v } })} />
          </Row>
          <Row query={q} label="Autoplay next" desc="Continue with the next video in the queue">
            <Switch ariaLabel="Autoplay next" checked={s.playback.autoPlay} onChange={(v) => patch({ playback: { autoPlay: v } })} />
          </Row>
          <Row query={q} label="Default speed" wide>
            <Slider ariaLabel="Default speed" value={s.playback.defaultRate} min={0.25} max={3} step={0.25} onChange={(v) => patch({ playback: { defaultRate: v } })} format={formatRate} />
            <span className={styles.sliderValue}>{formatRate(s.playback.defaultRate)}</span>
          </Row>
          <Row query={q} label="Arrow key seek" desc="Seconds jumped with ← →" wide>
            <Slider ariaLabel="Arrow seek seconds" value={s.playback.seekSmallSec} min={1} max={30} step={1} onChange={(v) => patch({ playback: { seekSmallSec: v } })} />
            <span className={styles.sliderValue}>{s.playback.seekSmallSec}s</span>
          </Row>
          <Row query={q} label="J / L seek" desc="Seconds jumped with J and L" wide>
            <Slider ariaLabel="JL seek seconds" value={s.playback.seekLargeSec} min={5} max={60} step={5} onChange={(v) => patch({ playback: { seekLargeSec: v } })} />
            <span className={styles.sliderValue}>{s.playback.seekLargeSec}s</span>
          </Row>
          <Row query={q} label="Hardware decoding" desc="GPU-accelerated video decode (H.264, VP9, AV1, HEVC). Takes effect after restarting Lumen.">
            <Switch ariaLabel="Hardware decoding" checked={s.playback.hardwareDecoding} onChange={(v) => patch({ playback: { hardwareDecoding: v } })} />
          </Row>
        </Section>

        <Section id="video" label="Video" icon={<MonitorCog size={16} />}>
          <Row query={q} label="Resolution" desc="Cap the render resolution. Lower settings downscale for smoother playback on weaker GPUs; you can't add detail above a file's own resolution." wide>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {availableResolutions(undefined).map((o) => (
                <Button
                  key={String(o.value)}
                  size="sm"
                  variant={s.video.cap === o.value ? 'accentSoft' : 'ghost'}
                  onClick={() => { patch({ video: { cap: o.value } }); applyVideo() }}
                >
                  {o.value === 'auto' ? 'Auto' : o.label}
                </Button>
              ))}
            </div>
          </Row>
          <Row query={q} label="HDR / tone mapping" desc="Vivid grades toward richer color; SDR tones highlights down. Native HDR passthrough arrives with the libmpv engine.">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['auto', 'vivid', 'off'] as const).map((m) => (
                <Button key={m} size="sm" variant={s.video.hdr === m ? 'accentSoft' : 'ghost'} onClick={() => { patch({ video: { hdr: m } }); applyVideo() }}>
                  {m === 'auto' ? 'Auto' : m === 'vivid' ? 'HDR vivid' : 'SDR'}
                </Button>
              ))}
            </div>
          </Row>
          {(['brightness', 'contrast', 'saturation', 'gamma'] as const).map((key) => {
            const bounds = { brightness: [0.5, 1.5], contrast: [0.5, 1.5], saturation: [0, 2], gamma: [0.6, 1.8] }[key]
            return (
              <Row key={key} query={q} label={key[0].toUpperCase() + key.slice(1)} wide>
                <Slider
                  ariaLabel={key}
                  value={s.video.color[key]}
                  min={bounds[0]}
                  max={bounds[1]}
                  step={0.01}
                  onChange={(v) => { patch({ video: { color: { ...s.video.color, [key]: Math.round(v * 100) / 100 } as ColorAdjust } }); applyVideo() }}
                />
                <span className={styles.sliderValue}>{Math.round(s.video.color[key] * 100)}%</span>
              </Row>
            )
          })}
          {!q && (
            <div className={styles.rowBlock} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => { patch({ video: { cap: 'auto', hdr: 'auto', color: { ...DEFAULT_COLOR } } }); applyVideo() }}>
                Reset video settings
              </Button>
            </div>
          )}
          <Row query={q} label="mpv engine (MKV, AVI, HEVC, HDR)" desc={mpvAvailable ? 'Detected — MKV, AVI, WMV, FLV and other formats play through mpv with true HDR tone-mapping.' : 'Not found. Install the free mpv player, then locate it here to unlock MKV/AVI/WMV and full HDR. HEVC in MP4/MOV already plays in the built-in engine.'}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={styles.sliderValue} style={{ minWidth: 0, color: mpvAvailable ? 'var(--ok)' : 'var(--text-3)' }}>
                {mpvAvailable ? 'Ready' : 'Not set up'}
              </span>
              {!mpvAvailable && (
                <Button size="sm" variant="subtle" onClick={() => window.open('https://mpv.io/installation/', '_blank')}>Get mpv</Button>
              )}
              <Button size="sm" variant={mpvAvailable ? 'ghost' : 'accentSoft'} onClick={() => void locateMpv()}>
                {mpvAvailable ? 'Change…' : 'Locate mpv.exe…'}
              </Button>
            </div>
          </Row>
        </Section>

        <Section id="audio" label="Audio" icon={<AudioLines size={16} />}>
          <Row query={q} label="Volume boost" desc="Pre-amplify beyond 100% — useful for quiet files" wide>
            <Slider ariaLabel="Volume boost" value={s.audio.boost} min={1} max={3} step={0.1} onChange={(v) => { patch({ audio: { boost: Math.round(v * 10) / 10 } }); apply() }} />
            <span className={styles.sliderValue}>{Math.round(s.audio.boost * 100)}%</span>
          </Row>
          <Row query={q} label="Volume normalization" desc="Evens out loud and quiet passages">
            <Switch ariaLabel="Normalization" checked={s.audio.normalize} onChange={(v) => { patch({ audio: { normalize: v } }); apply() }} />
          </Row>
          <Row query={q} label="Equalizer" desc="10-band graphic EQ">
            <Switch ariaLabel="Equalizer" checked={s.audio.eqEnabled} onChange={(v) => { patch({ audio: { eqEnabled: v } }); apply() }} />
          </Row>
          {!q && (
            <div className={styles.rowBlock}>
              <Equalizer />
            </div>
          )}
        </Section>

        <Section id="subtitles" label="Subtitles" icon={<Captions size={16} />}>
          {!q && (
            <div className={styles.rowBlock} style={{ containerType: 'inline-size' }}>
              <SubtitlePreview />
            </div>
          )}
          <Row query={q} label="Auto-load subtitles" desc="Load matching .srt/.vtt files found next to the video">
            <Switch ariaLabel="Auto-load subtitles" checked={s.subtitles.autoLoad} onChange={(v) => patch({ subtitles: { autoLoad: v } })} />
          </Row>
          <Row query={q} label="Font">
            <Button size="sm" variant="subtle" onClick={(e) => setFontMenu(anchorFromElement(e.currentTarget, 'bottom', 'end'))}>
              {sub.fontFamily}
            </Button>
            <Menu
              open={!!fontMenu}
              anchor={fontMenu}
              onClose={() => setFontMenu(null)}
              entries={FONTS.map((f) => ({ id: f, label: f, checked: sub.fontFamily === f, onSelect: () => patch({ subtitles: { style: { ...sub, fontFamily: f } } }) }))}
            />
          </Row>
          <Row query={q} label="Size" wide>
            <Slider ariaLabel="Subtitle size" value={sub.sizePct} min={2.5} max={9} step={0.1} onChange={(v) => patch({ subtitles: { style: { ...sub, sizePct: Math.round(v * 10) / 10 } } })} />
            <span className={styles.sliderValue}>{Math.round((sub.sizePct / 4.4) * 100)}%</span>
          </Row>
          <Row query={q} label="Color">
            <div style={{ display: 'flex', gap: 8 }}>
              {['#ffffff', '#f5e642', '#7de3ff', '#9dff8a'].map((c) => (
                <button key={c} className={`${styles.swatch} ${sub.color === c ? styles.on : ''}`} style={{ background: c, width: 26, height: 26 }} aria-label={`Subtitle color ${c}`} onClick={() => patch({ subtitles: { style: { ...sub, color: c } } })} />
              ))}
              <label className={styles.customSwatch} style={{ width: 26, height: 26 }}>
                <input type="color" value={sub.color} onChange={(e) => patch({ subtitles: { style: { ...sub, color: e.target.value } } })} aria-label="Custom subtitle color" />
              </label>
            </div>
          </Row>
          <Row query={q} label="Bold text">
            <Switch ariaLabel="Bold subtitles" checked={sub.bold} onChange={(v) => patch({ subtitles: { style: { ...sub, bold: v } } })} />
          </Row>
          <Row query={q} label="Outline" desc="Dark edge for readability on bright scenes">
            <Switch ariaLabel="Subtitle outline" checked={sub.outline} onChange={(v) => patch({ subtitles: { style: { ...sub, outline: v } } })} />
          </Row>
          <Row query={q} label="Drop shadow">
            <Switch ariaLabel="Subtitle shadow" checked={sub.shadow} onChange={(v) => patch({ subtitles: { style: { ...sub, shadow: v } } })} />
          </Row>
          <Row query={q} label="Background plate" desc="Opacity of the box behind text" wide>
            <Slider ariaLabel="Subtitle background" value={sub.bgOpacity} min={0} max={0.9} step={0.05} onChange={(v) => patch({ subtitles: { style: { ...sub, bgOpacity: Math.round(v * 20) / 20 } } })} />
            <span className={styles.sliderValue}>{Math.round(sub.bgOpacity * 100)}%</span>
          </Row>
          <Row query={q} label="Vertical position" desc="Distance from the bottom edge" wide>
            <Slider ariaLabel="Subtitle position" value={sub.bottomPct} min={2} max={30} step={1} onChange={(v) => patch({ subtitles: { style: { ...sub, bottomPct: v } } })} />
            <span className={styles.sliderValue}>{sub.bottomPct}%</span>
          </Row>
        </Section>

        <Section id="shortcuts" label="Shortcuts" icon={<Keyboard size={16} />}>
          {!q && (
            <div className={styles.rowBlock}>
              <div className={styles.rowDesc}>
                Click a binding, then press the new keys. <Kbd>Backspace</Kbd> unbinds, <Kbd>Esc</Kbd> cancels.
              </div>
            </div>
          )}
          <ShortcutsEditor query={q} />
        </Section>

        <Section id="library" label="Library" icon={<FolderCog size={16} />}>
          <Row query={q} label="Watched folders" desc="Lumen indexes these folders and watches them for changes. Your Windows Videos folder is added automatically on first run.">
            <span />
          </Row>
          <LibraryFolders />
        </Section>

        <Section id="privacy" label="Privacy & About" icon={<ShieldCheck size={16} />}>
          <Row query={q} label="Telemetry" desc="There is none. Lumen makes zero network requests — no analytics, no update pings, no accounts.">
            <Switch ariaLabel="Telemetry (permanently off)" checked={false} onChange={() => {}} disabled />
          </Row>
          <Row query={q} label="Your display" desc="Detected output capability for HDR content">
            <span className={styles.sliderValue} style={{ minWidth: 0 }}>{hdrDisplay ? 'HDR capable' : 'SDR'}</span>
          </Row>
          <Row query={q} label="About" desc={`Lumen ${version || '0.1.0'} — a luminous home for your videos. ${isDesktop ? 'Desktop' : 'Browser preview'} build.`}>
            <span />
          </Row>
        </Section>
      </div>
    </div>
  )
}
