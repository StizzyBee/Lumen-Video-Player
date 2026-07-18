import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Tooltip } from './Tooltip'
import styles from './IconButton.module.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  /** Keyboard hint appended to the tooltip, e.g. "Space" */
  kbd?: string
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  onVideo?: boolean
  showDot?: boolean
  noTooltip?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, kbd, size = 'md', active, onVideo, showDot, noTooltip, className, children, ...rest },
  ref
) {
  const btn = (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active || undefined}
      className={[
        styles.iconBtn,
        styles[size],
        active ? styles.active : '',
        onVideo ? styles.onVideo : '',
        showDot ? styles.dot : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
  if (noTooltip) return btn
  return (
    <Tooltip label={label} kbd={kbd}>
      {btn}
    </Tooltip>
  )
})
