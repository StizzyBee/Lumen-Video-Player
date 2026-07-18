import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import styles from './Menu.module.css'

export type MenuEntry =
  | { type?: 'item'; id: string; label: string; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { type: 'separator' }
  | { type: 'header'; label: string }

export interface MenuAnchor {
  /** Anchor rect (from a trigger) or a point (context menu) */
  x: number
  y: number
  width?: number
  height?: number
  align?: 'start' | 'end' | 'center'
  side?: 'top' | 'bottom'
}

interface MenuProps {
  open: boolean
  anchor: MenuAnchor | null
  entries: MenuEntry[]
  onClose: () => void
  /** Keep open after selecting (for multi-toggle menus) */
  sticky?: boolean
  minWidth?: number
}

export function anchorFromElement(el: HTMLElement, side: 'top' | 'bottom' = 'bottom', align: 'start' | 'end' | 'center' = 'center'): MenuAnchor {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height, side, align }
}

export function Menu({ open, anchor, entries, onClose, sticky, minWidth }: MenuProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null)
      return
    }
    const el = ref.current
    if (!el) return
    const mw = el.offsetWidth
    const mh = el.offsetHeight
    const aw = anchor.width ?? 0
    const ah = anchor.height ?? 0
    const side = anchor.side ?? 'bottom'
    const align = anchor.align ?? 'center'

    let left = align === 'start' ? anchor.x : align === 'end' ? anchor.x + aw - mw : anchor.x + aw / 2 - mw / 2
    let top = side === 'bottom' ? anchor.y + ah + 6 : anchor.y - mh - 6
    let vOrigin = side === 'bottom' ? 'top' : 'bottom'

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8))
    if (top < 8) {
      top = anchor.y + ah + 6
      vOrigin = 'top'
    }
    if (top + mh > window.innerHeight - 8) {
      top = Math.max(8, anchor.y - mh - 6)
      vOrigin = 'bottom'
    }
    const hOrigin = align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'
    setPos({ left, top, origin: `${vOrigin} ${hOrigin}` })
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!items.length) return
        const idx = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && anchor && (
        <>
          <div
            className={styles.overlay}
            onPointerDown={(e) => {
              e.stopPropagation()
              onClose()
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onClose()
            }}
          />
          <motion.div
            ref={ref}
            className={styles.menu}
            role="menu"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              transformOrigin: pos?.origin,
              minWidth,
              visibility: pos ? 'visible' : 'hidden'
            }}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 700, damping: 42 }}
          >
            {entries.map((entry, i) => {
              if (entry.type === 'separator') return <div key={i} className={styles.separator} role="separator" />
              if (entry.type === 'header')
                return (
                  <div key={i} className={styles.header}>
                    {entry.label}
                  </div>
                )
              return (
                <button
                  key={entry.id}
                  role="menuitem"
                  disabled={entry.disabled}
                  className={[styles.item, entry.danger ? styles.danger : '', entry.checked ? styles.checked : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    entry.onSelect()
                    if (!sticky) onClose()
                  }}
                >
                  {entry.icon ? <span className={styles.icon}>{entry.icon}</span> : null}
                  <span className={styles.label}>{entry.label}</span>
                  {entry.hint ? <span className={styles.hint}>{entry.hint}</span> : null}
                  {entry.checked ? (
                    <span className={styles.check}>
                      <Check size={15} strokeWidth={2.5} />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
