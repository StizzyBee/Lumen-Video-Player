import { useEffect, useState, type ReactNode } from 'react'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { resolutionLabel, formatBytes, formatRate } from '@/core/utils/format'
import styles from './PlayerView.module.css'

export function StatsOverlay(): ReactNode {
  const p = usePlayer()
  const audio = useSettings((s) => s.settings.audio)
  const video = useSettings((s) => s.settings.video)
  const hwdec = useSettings((s) => s.settings.playback.hardwareDecoding)
  const [quality, setQuality] = useState<{ dropped: number; total: number } | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setQuality(usePlayer.getState().engineQuality()), 1000)
    setQuality(usePlayer.getState().engineQuality())
    return () => window.clearInterval(t)
  }, [])

  if (!p.item) return null
  const onMpv = p.mpvMode === 'playing'
  const d = p.dimensions
  const displayHdr = window.matchMedia?.('(dynamic-range: high)')?.matches ?? false
  const bufferedAhead = p.buffered.reduce((acc, [s, e]) => (p.time >= s && p.time <= e ? Math.max(acc, e - p.time) : acc), 0)

  // Real HDR status: mpv reports the source's signal peak; passthrough only
  // happens on an HDR display with the HDR mode not forced to SDR.
  const hdrRow =
    p.hdrContent === null
      ? onMpv
        ? '—'
        : 'SDR (built-in engine)'
      : !p.hdrContent
        ? 'SDR source'
        : video.hdr === 'off'
          ? 'HDR source → tone-mapped to SDR'
          : displayHdr
            ? 'HDR source → passthrough'
            : 'HDR source → tone-mapped (SDR display)'

  const rows: Array<[string, string]> = [
    ['File', p.item.fileName],
    ['Container', p.item.ext ? p.item.ext.toUpperCase() : '—'],
    ['Size', p.item.sizeBytes ? formatBytes(p.item.sizeBytes) : '—'],
    ['Resolution', d ? `${d.width}×${d.height}${resolutionLabel(d.width, d.height) ? ` (${resolutionLabel(d.width, d.height)})` : ''}` : '—'],
    ['HDR', hdrRow],
    ['Speed', formatRate(p.rate)],
    ['Volume', `${Math.round(audio.volume * 100)}%${!onMpv && audio.boost > 1 ? ` +boost ${Math.round(audio.boost * 100)}%` : ''}`],
    ['Buffered ahead', onMpv ? '—' : `${bufferedAhead.toFixed(1)}s`],
    ['Dropped frames', !onMpv && quality ? `${quality.dropped} / ${quality.total}` : '—'],
    ['Display', displayHdr ? 'HDR capable' : 'SDR'],
    ['Engine', onMpv ? `mpv · gpu-next · ${hwdec ? 'hardware' : 'software'} decode` : 'Chromium · hardware accelerated'],
    [
      'Subtitles',
      onMpv
        ? p.mpvTracks.sub.find((t) => t.selected)?.label ?? 'Off'
        : p.activeSubId
          ? `${p.subTracks.find((t) => t.id === p.activeSubId)?.label ?? 'On'} (${p.subDelayMs}ms)`
          : 'Off'
    ]
  ]

  return (
    <div className={styles.stats} role="status">
      {rows.map(([k, v]) => (
        <div key={k} className={styles.statsRow}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}
