import { forwardRef, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import styles from './bits.module.css'

export function Badge({
  children,
  variant = 'overlay',
  className
}: {
  children: ReactNode
  variant?: 'overlay' | 'soft' | 'accent'
  className?: string
}): ReactNode {
  const cls = [
    styles.badge,
    variant === 'soft' ? styles.badgeSoft : variant === 'accent' ? styles.badgeAccent : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return <span className={cls}>{children}</span>
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return <kbd className={styles.kbd}>{children}</kbd>
}

export function Skeleton({ style, className }: { style?: CSSProperties; className?: string }): ReactNode {
  return <div className={[styles.skeleton, className].filter(Boolean).join(' ')} style={style} aria-hidden />
}

export function ProgressBar({ fraction, style }: { fraction: number; style?: CSSProperties }): ReactNode {
  return (
    <div className={styles.progressOuter} style={style}>
      <div className={styles.progressInner} style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  actions
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
}): ReactNode {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon}</div>
      <h2 className={styles.emptyTitle}>{title}</h2>
      {description ? <p className={styles.emptyDesc}>{description}</p> : null}
      {actions ? <div className={styles.emptyActions}>{actions}</div> : null}
    </div>
  )
}

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onValueChange: (v: string) => void
  onClear?: () => void
  wrapClassName?: string
  wrapStyle?: CSSProperties
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, onClear, wrapClassName, wrapStyle, ...rest },
  ref
) {
  return (
    <div className={[styles.search, wrapClassName].filter(Boolean).join(' ')} style={wrapStyle}>
      <Search size={15} strokeWidth={2} style={{ flex: 'none' }} />
      <input ref={ref} value={value} onChange={(e) => onValueChange(e.target.value)} spellCheck={false} {...rest} />
      {value && (
        <button
          aria-label="Clear search"
          onClick={() => {
            onValueChange('')
            onClear?.()
          }}
          style={{ display: 'flex', color: 'var(--text-3)' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
})
