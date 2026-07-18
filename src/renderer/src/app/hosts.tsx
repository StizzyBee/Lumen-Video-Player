// Overlay hosts: toasts, context menus, confirm dialogs, drag & drop target.
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Info, CircleCheck, TriangleAlert, CircleAlert, Download } from 'lucide-react'
import { useUi } from '@/core/store/ui'
import { Menu } from '@/components/ui/Menu'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import toastStyles from '@/components/ui/Toast.module.css'
import styles from './hosts.module.css'

const KIND_ICON = {
  info: <Info size={17} />,
  ok: <CircleCheck size={17} />,
  warn: <TriangleAlert size={17} />,
  danger: <CircleAlert size={17} />
} as const

export function ToastHost(): ReactNode {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className={toastStyles.host} role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={toastStyles.toast}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            onClick={() => dismiss(t.id)}
          >
            <span className={`${toastStyles.icon} ${toastStyles[t.kind] ?? ''}`}>
              {t.icon ?? KIND_ICON[t.kind]}
            </span>
            <div className={toastStyles.content}>
              <div className={toastStyles.title}>{t.title}</div>
              {t.desc ? <div className={toastStyles.desc}>{t.desc}</div> : null}
            </div>
            {t.action ? (
              <button
                className={toastStyles.action}
                onClick={(e) => {
                  e.stopPropagation()
                  t.action?.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function ContextMenuHost(): ReactNode {
  const cm = useUi((s) => s.contextMenu)
  const close = useUi((s) => s.closeContextMenu)
  return <Menu open={!!cm} anchor={cm?.anchor ?? null} entries={cm?.entries ?? []} onClose={close} />
}

export function ConfirmHost(): ReactNode {
  const confirm = useUi((s) => s.confirm)
  const close = useUi((s) => s.closeConfirm)
  return (
    <Dialog
      open={!!confirm}
      title={confirm?.title ?? ''}
      onClose={close}
      actions={
        confirm ? (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={confirm.danger ? 'danger' : 'primary'}
              onClick={() => {
                confirm.onConfirm()
                close()
              }}
            >
              {confirm.confirmLabel}
            </Button>
          </>
        ) : null
      }
    >
      {confirm?.body}
    </Dialog>
  )
}

export function DropOverlay(): ReactNode {
  const active = useUi((s) => s.dropActive)
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className={styles.drop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <motion.div
            className={styles.dropCard}
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className={styles.dropRing}>
              <Download size={28} strokeWidth={1.8} />
            </div>
            <div className={styles.dropTitle}>Drop to play</div>
            <div className={styles.dropDesc}>Videos open instantly · subtitles attach to the current video</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
