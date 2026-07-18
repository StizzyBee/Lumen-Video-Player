import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { dialogMotion } from '@/design/motion'
import styles from './Dialog.module.css'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children?: ReactNode
  actions?: ReactNode
  wide?: boolean
}

export function Dialog({ open, title, onClose, children, actions, wide }: DialogProps): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            className={styles.card}
            style={wide ? { width: 'min(680px, 100%)' } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            {...dialogMotion}
          >
            <h2 className={styles.title}>{title}</h2>
            <div className={styles.body}>{children}</div>
            {actions ? <div className={styles.actions}>{actions}</div> : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
