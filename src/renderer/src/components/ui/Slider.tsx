import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import styles from './Slider.module.css'

export interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  /** Extra layers rendered inside the track (buffered ranges, chapter ticks) */
  trackChildren?: ReactNode
  ariaLabel: string
  format?: (v: number) => string
  className?: string
  onHover?: (fraction: number | null, clientX: number) => void
  disabled?: boolean
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function Slider({
  value,
  min = 0,
  max = 1,
  step,
  onChange,
  onDragStart,
  onDragEnd,
  trackChildren,
  ariaLabel,
  format,
  className,
  onHover,
  disabled
}: SliderProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const range = max - min || 1
  const frac = clamp((value - min) / range, 0, 1)

  const valueFromEvent = useCallback(
    (clientX: number): number => {
      const el = ref.current
      if (!el) return value
      const r = el.getBoundingClientRect()
      const f = clamp((clientX - r.left) / r.width, 0, 1)
      let v = min + f * range
      if (step) v = Math.round(v / step) * step
      return clamp(v, min, max)
    },
    [min, max, range, step, value]
  )

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    setDragging(true)
    onDragStart?.()
    onChange(valueFromEvent(e.clientX))
  }
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging) onChange(valueFromEvent(e.clientX))
    else if (onHover && ref.current) {
      const r = ref.current.getBoundingClientRect()
      onHover(clamp((e.clientX - r.left) / r.width, 0, 1), e.clientX)
    }
  }
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragging(false)
    onChange(valueFromEvent(e.clientX))
    onDragEnd?.()
  }

  const handleKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const s = step ?? range / 50
    let v: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value + s
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value - s
    if (e.key === 'Home') v = min
    if (e.key === 'End') v = max
    if (v !== null) {
      e.preventDefault()
      e.stopPropagation()
      onChange(clamp(v, min, max))
    }
  }

  return (
    <div
      ref={ref}
      className={[styles.root, dragging ? styles.dragging : '', className].filter(Boolean).join(' ')}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format?.(value)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => onHover?.(null, 0)}
      onKeyDown={handleKey}
    >
      <div className={styles.track}>
        {trackChildren}
        <div className={styles.fill} style={{ width: `${frac * 100}%` }} />
        <div className={styles.thumb} style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  )
}
