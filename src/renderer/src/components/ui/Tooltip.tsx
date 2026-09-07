import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  label: ReactNode
  kbd?: string
  /** Preferred side */
  side?: 'top' | 'bottom'
  delay?: number
  children: ReactElement
}

export function Tooltip({ label, kbd, side = 'top', delay = 500, children }: TooltipProps): ReactNode {
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null)
  const timer = useRef<number | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const tip = useRef<HTMLDivElement | null>(null)

  /**
   * Pull the tooltip back inside the window. It is centred on its trigger and
   * never wraps, so a long label on a button near an edge — the revoke button
   * at the right of the watch-party panel, say — runs off screen and the end
   * of the sentence is simply unreadable.
   */
  useLayoutEffect(() => {
    const el = tip.current
    if (!pos || !el) return
    const margin = 8
    const half = el.offsetWidth / 2
    const clamped = Math.min(Math.max(pos.x, margin + half), window.innerWidth - margin - half)
    if (Math.abs(clamped - pos.x) > 0.5) setPos({ ...pos, x: clamped })
  }, [pos])

  const show = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let s = side
    if (s === 'top' && r.top < 46) s = 'bottom'
    if (s === 'bottom' && r.bottom > window.innerHeight - 46) s = 'top'
    setPos({ x: r.left + r.width / 2, y: s === 'top' ? r.top - 8 : r.bottom + 8, side: s })
  }, [side])

  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setPos(null)
  }, [])

  useEffect(() => clear, [clear])

  if (!isValidElement(children)) return children

  const childProps = children.props as Record<string, unknown>
  const merged = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node
      const r = (children as { ref?: unknown }).ref
      if (typeof r === 'function') r(node)
      else if (r && typeof r === 'object') (r as { current: unknown }).current = node
    },
    onMouseEnter: (e: MouseEvent) => {
      ;(childProps.onMouseEnter as ((e: MouseEvent) => void) | undefined)?.(e)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(show, delay)
    },
    onMouseLeave: (e: MouseEvent) => {
      ;(childProps.onMouseLeave as ((e: MouseEvent) => void) | undefined)?.(e)
      clear()
    },
    onMouseDown: (e: MouseEvent) => {
      ;(childProps.onMouseDown as ((e: MouseEvent) => void) | undefined)?.(e)
      clear()
    }
  } as Record<string, unknown>)

  return (
    <>
      {merged}
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={tip}
              className={styles.tip}
              initial={{ opacity: 0, scale: 0.92, y: pos.side === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ type: 'spring', stiffness: 700, damping: 40 }}
              style={{
                left: pos.x,
                top: pos.y,
                transform: 'translateX(-50%)',
                translate: '-50% ' + (pos.side === 'top' ? '-100%' : '0')
              }}
              role="tooltip"
            >
              {label}
              {kbd ? <span className={styles.kbd}>{kbd}</span> : null}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
