import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
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
