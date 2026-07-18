import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Square, Copy, X, Search } from 'lucide-react'
import { platform, isDesktop } from '@/core/platform'
import { useUi } from '@/core/store/ui'
import { Kbd } from '@/components/ui/bits'
import styles from './TitleBar.module.css'

export function LumenGlyph({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="var(--accent)" opacity="0.18" />
      <path
        d="M19 16.8c0-1.6 1.74-2.58 3.1-1.74l11.2 6.94a2.04 2.04 0 0 1 0 3.47L22.1 32.4c-1.36.84-3.1-.14-3.1-1.74V16.8Z"
        fill="var(--accent)"
      />
    </svg>
  )
}

export function TitleBar(): ReactNode {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void platform.win.isMaximized().then(setMaximized)
    return platform.win.onMaximized(setMaximized)
  }, [])

  return (
    <header
      className={styles.bar}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        platform.win.toggleMaximize()
      }}
    >
      <div className={styles.brand}>
        <LumenGlyph />
        <span>Lumen</span>
      </div>

      <div className={styles.searchWrap}>
        <button className={styles.searchPill} onClick={() => setPaletteOpen(true, '')}>
          <Search size={13} strokeWidth={2} />
          <span className={styles.grow}>Search your library</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      {isDesktop ? (
        <div className={styles.caption}>
          <button className={styles.captionBtn} aria-label="Minimize" onClick={() => platform.win.minimize()}>
            <Minus size={15} strokeWidth={1.5} />
          </button>
          <button
            className={styles.captionBtn}
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => platform.win.toggleMaximize()}
          >
            {maximized ? <Copy size={13} strokeWidth={1.5} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} strokeWidth={1.5} />}
          </button>
          <button
            className={`${styles.captionBtn} ${styles.captionClose}`}
            aria-label="Close"
            onClick={() => platform.win.close()}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <div style={{ width: 180 }} />
      )}
    </header>
  )
}
