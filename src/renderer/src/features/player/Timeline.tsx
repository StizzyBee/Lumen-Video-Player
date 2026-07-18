import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePlayer } from '@/core/store/player'
import { platform } from '@/core/platform'
import { setVideoSource } from '@/core/media'
import { Slider } from '@/components/ui/Slider'
import { formatTime } from '@/core/utils/format'
import styles from './Timeline.module.css'

/** Seek bar with buffered ranges, A–B markers, and hover thumbnail preview. */
export function Timeline(): ReactNode {
  const time = usePlayer((s) => s.time)
  const duration = usePlayer((s) => s.duration)
  const buffered = usePlayer((s) => s.buffered)
  const ab = usePlayer((s) => s.ab)
  const item = usePlayer((s) => s.item)
  const seekTo = usePlayer((s) => s.seekTo)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)
  const [hover, setHover] = useState<{ frac: number; x: number } | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const previewVideo = useRef<HTMLVideoElement | null>(null)
  const previewCanvas = useRef<HTMLCanvasElement | null>(null)
  const previewReq = useRef(0)

  // Lazy preview video shares the same source for thumbnail scrubbing
  useEffect(() => {
    if (!item) return
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    setVideoSource(v, platform.media.url(item.path))
    previewVideo.current = v
    const onMeta = (): void => {
      // resolve Infinity durations (MediaRecorder-style files) so previews can seek
      if (!Number.isFinite(v.duration)) v.currentTime = 1e10
    }
    v.addEventListener('loadedmetadata', onMeta)
    const onSeeked = (): void => {
      const canvas = previewCanvas.current
      if (!canvas || !v.videoWidth) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 336
      canvas.height = Math.round((336 * v.videoHeight) / v.videoWidth)
      try {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      } catch {
        // tainted canvas in browser preview — time tooltip still works
      }
    }
    v.addEventListener('seeked', onSeeked)
    return () => {
      v.removeEventListener('seeked', onSeeked)
      v.removeAttribute('src')
      v.load()
      previewVideo.current = null
    }
  }, [item])

  const requestPreview = useCallback(
    (frac: number) => {
      const v = previewVideo.current
      if (!v || !duration || !Number.isFinite(v.duration ?? NaN)) return
      const t = frac * duration
      window.clearTimeout(previewReq.current)
      previewReq.current = window.setTimeout(() => {
        if (previewVideo.current && Number.isFinite(previewVideo.current.duration)) {
          previewVideo.current.currentTime = Math.min(t, previewVideo.current.duration - 0.1)
        }
      }, 90)
    },
    [duration]
  )

  const onHover = useCallback(
    (frac: number | null, clientX: number) => {
      if (frac === null) {
        setHover(null)
        return
      }
      const wrap = wrapRef.current
      if (!wrap) return
      const r = wrap.getBoundingClientRect()
      setHover({ frac, x: clientX - r.left })
      requestPreview(frac)
    },
    [requestPreview]
  )

  const shown = scrubbing ? scrubValue : time
  const dur = duration || 1

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {hover && duration > 0 && (
        <div className={styles.preview} style={{ left: clampPreview(hover.x, wrapRef.current?.clientWidth ?? 0) }}>
          <span className={styles.previewThumb}>
            <canvas ref={previewCanvas} />
          </span>
          <span className={styles.previewTime}>{formatTime(hover.frac * duration)}</span>
        </div>
      )}
      <Slider
        className={styles.timeline}
        ariaLabel="Seek"
        value={shown}
        min={0}
        max={dur}
        onChange={(v) => {
          setScrubValue(v)
          if (scrubbing) seekTo(v)
        }}
        onDragStart={() => {
          setScrubbing(true)
          setScrubValue(time)
        }}
        onDragEnd={() => {
          setScrubbing(false)
          seekTo(scrubValue)
        }}
        onHover={onHover}
        format={formatTime}
        trackChildren={
          <>
            {buffered.map(([s, e], i) => (
              <div
                key={i}
                className={styles.buffered}
                style={{ left: `${(s / dur) * 100}%`, width: `${((e - s) / dur) * 100}%` }}
              />
            ))}
            {ab.a !== null && ab.b !== null && (
              <div
                className={styles.abRange}
                style={{ left: `${(ab.a / dur) * 100}%`, width: `${((ab.b - ab.a) / dur) * 100}%` }}
              />
            )}
            {ab.a !== null && <div className={styles.abMarker} style={{ left: `${(ab.a / dur) * 100}%` }} />}
            {ab.b !== null && <div className={styles.abMarker} style={{ left: `${(ab.b / dur) * 100}%` }} />}
          </>
        }
      />
    </div>
  )
}

function clampPreview(x: number, width: number): number {
  const half = 92
  return Math.max(half, Math.min(x, Math.max(half, width - half)))
}
