// Custom subtitle renderer: full styling control independent of file styling.
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { activeCues } from '@/core/subtitles'

export function SubtitleLayer(): ReactNode {
  const tracks = usePlayer((s) => s.subTracks)
  const activeId = usePlayer((s) => s.activeSubId)
  const time = usePlayer((s) => s.time)
  const delayMs = usePlayer((s) => s.subDelayMs)
  const style = useSettings((s) => s.settings.subtitles.style)

  const track = useMemo(() => tracks.find((t) => t.id === activeId), [tracks, activeId])
  if (!track) return null
  const cues = activeCues(track.cues, time * 1000, delayMs)
  if (!cues.length) return null

  const textShadow = [
    style.outline
      ? '0 0 2px rgba(0,0,0,.95), 1.5px 1.5px 0 rgba(0,0,0,.85), -1.5px 1.5px 0 rgba(0,0,0,.85), 1.5px -1.5px 0 rgba(0,0,0,.85), -1.5px -1.5px 0 rgba(0,0,0,.85)'
      : '',
    style.shadow ? '0 3px 10px rgba(0,0,0,.8)' : ''
  ]
    .filter(Boolean)
    .join(', ')

  const wrap: CSSProperties = {
    position: 'absolute',
    left: '6%',
    right: '6%',
    bottom: `${style.bottomPct}%`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    pointerEvents: 'none',
    zIndex: 5
  }
  const line: CSSProperties = {
    fontFamily: `'${style.fontFamily}', 'Segoe UI', sans-serif`,
    fontSize: `min(${style.sizePct}vh, ${style.sizePct * 1.4}vw)`,
    fontWeight: style.bold ? 700 : 500,
    lineHeight: 1.35,
    color: style.color,
    textShadow: textShadow || undefined,
    background: style.bgOpacity > 0 ? `rgba(0,0,0,${style.bgOpacity})` : 'transparent',
    padding: style.bgOpacity > 0 ? '0.15em 0.5em' : 0,
    borderRadius: style.bgOpacity > 0 ? 8 : 0,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
    maxWidth: '100%'
  }

  return (
    <div style={wrap} aria-live="off">
      {cues.map((c, i) => (
        <div key={`${c.startMs}-${i}`} style={line}>
          {c.text}
        </div>
      ))}
    </div>
  )
}
