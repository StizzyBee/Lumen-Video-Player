import { useEffect, useState, type ReactNode } from 'react'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { resolutionLabel, formatBytes, formatRate } from '@/core/utils/format'
import styles from './PlayerView.module.css'

export function StatsOverlay(): ReactNode {
  const p = usePlayer()
  const audio = useSettings((s) => s.settings.audio)
  const [quality, setQuality] = useState<{ dropped: number; total: number } | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setQuality(usePlayer.getState().engineQuality()), 1000)
    setQuality(usePlayer.getState().engineQuality())
    return () => window.clearInterval(t)
  }, [])

  if (!p.item) return null
  const d = p.dimensions
  const bufferedAhead = p.buffered.reduce((acc, [s, e]) => (p.time >= s && p.time <= e ? Math.max(acc, e - p.time) : acc), 0)

  const rows: Array<[string, string]> = [
    ['File', p.item.fileName],
    ['Container', p.item.ext.toUpperCase()],
    ['Size', formatBytes(p.item.sizeBytes)],
    ['Resolution', d ? `${d.width}×${d.height}${resolutionLabel(d.width, d.height) ? ` (${resolutionLabel(d.width, d.height)})` : ''}` : '—'],
    ['Speed', formatRate(p.rate)],
    ['Volume', `${Math.round(audio.volume * 100)}%${audio.boost > 1 ? ` +boost ${Math.round(audio.boost * 100)}%` : ''}`],
    ['Buffered ahead', `${bufferedAhead.toFixed(1)}s`],
    ['Dropped frames', quality ? `${quality.dropped} / ${quality.total}` : '—'],
    ['Display', window.matchMedia?.('(dynamic-range: high)')?.matches ? 'HDR capable (tone-mapped)' : 'SDR'],
    ['Engine', 'Chromium · hardware accelerated'],
    ['Subtitles', p.activeSubId ? `${p.subTracks.find((t) => t.id === p.activeSubId)?.label ?? 'On'} (${p.subDelayMs}ms)` : 'Off']
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
