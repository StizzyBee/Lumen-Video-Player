import { memo, useState, type ReactNode } from 'react'
import { Film, Play, Heart, Pin, MoreHorizontal, FolderOpen, RotateCcw } from 'lucide-react'
import type { LibraryItem } from '@shared/types'
import { platform, isDesktop } from '@/core/platform'
import { usePlayer } from '@/core/store/player'
import { useLibrary } from '@/core/store/library'
import { useUi } from '@/core/store/ui'
import { hasThumb } from '@/core/thumbs'
import { watchedFraction, isResumable } from '@/core/resume'
import { formatTime, resolutionLabel, formatRemaining } from '@/core/utils/format'
import { Badge, ProgressBar } from '@/components/ui/bits'
import type { MenuEntry } from '@/components/ui/Menu'
import styles from './MediaCard.module.css'

export function cardMenuEntries(item: LibraryItem, queue: string[]): MenuEntry[] {
  const player = usePlayer.getState()
  const lib = useLibrary.getState()
  return [
    { id: 'play', label: item.positionSec ? 'Resume' : 'Play', icon: <Play size={16} />, onSelect: () => player.openItem(item, { queue }) },
    ...(isResumable(item)
      ? [{ id: 'restart', label: 'Play from start', icon: <RotateCcw size={16} />, onSelect: () => player.openItem(item, { queue, startOver: true }) } as const]
      : []),
    { type: 'separator' as const },
    { id: 'fav', label: item.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Heart size={16} />, checked: item.favorite, onSelect: () => lib.toggleFavorite(item.id) },
    { id: 'pin', label: item.pinned ? 'Unpin' : 'Pin to home', icon: <Pin size={16} />, checked: item.pinned, onSelect: () => lib.togglePinned(item.id) },
    ...(isDesktop
      ? [
          { type: 'separator' as const },
          { id: 'reveal', label: 'Show in folder', icon: <FolderOpen size={16} />, onSelect: () => platform.shell.showInFolder(item.path) } as const
        ]
      : [])
  ]
}

interface MediaCardProps {
  item: LibraryItem
  /** ids forming the play queue when this card is opened */
  queue: string[]
  showRemaining?: boolean
}

export const MediaCard = memo(function MediaCard({ item, queue, showRemaining }: MediaCardProps): ReactNode {
  const openItem = usePlayer((s) => s.openItem)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const togglePinned = useLibrary((s) => s.togglePinned)
  const openContextMenu = useUi((s) => s.openContextMenu)
  const [loaded, setLoaded] = useState(false)

  const frac = watchedFraction(item)
  const res = resolutionLabel(item.width, item.height)
  const thumb = hasThumb(item) ? platform.thumbs.url(item.id) : null

  const onMenu = (x: number, y: number): void => openContextMenu({ x, y }, cardMenuEntries(item, queue))

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.card}
      onClick={() => openItem(item, { queue })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openItem(item, { queue })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onMenu(e.clientX, e.clientY)
      }}
      aria-label={item.title}
    >
      <div className={styles.thumbWrap}>
        {thumb ? (
          <img
            className={`${styles.thumb} ${loaded ? styles.loaded : ''}`}
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <Film size={30} strokeWidth={1.4} />
          </div>
        )}

        <div className={styles.badgeTL}>
          {res && <Badge>{res}</Badge>}
          {!hasThumb(item) && <Badge>{item.ext.toUpperCase()}</Badge>}
        </div>
        {item.durationSec ? (
          <div className={styles.badgeBR}>
            <Badge>{formatTime(item.durationSec)}</Badge>
          </div>
        ) : null}

        <div className={styles.playGlyph}>
          <span className={styles.playCircle}>
            <Play size={22} fill="currentColor" strokeWidth={0} style={{ marginLeft: 3 }} />
          </span>
        </div>

        <div className={styles.quick}>
          <button
            className={`${styles.quickBtn} ${item.favorite ? styles.on : ''}`}
            aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={item.favorite}
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(item.id)
            }}
          >
            <Heart size={15} fill={item.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className={`${styles.quickBtn} ${item.pinned ? styles.on : ''}`}
            aria-label={item.pinned ? 'Unpin' : 'Pin to home'}
            aria-pressed={item.pinned}
            onClick={(e) => {
              e.stopPropagation()
              togglePinned(item.id)
            }}
          >
            <Pin size={15} fill={item.pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            className={styles.quickBtn}
            aria-label="More options"
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              onMenu(r.left, r.bottom + 4)
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>

        {frac !== null && isResumable(item) && <ProgressBar fraction={frac} style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }} />}
      </div>

      <div className={styles.meta}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.sub}>
          {showRemaining && item.positionSec && item.durationSec
            ? formatRemaining(item.positionSec, item.durationSec)
            : item.folder.split(/[\\/]/).filter(Boolean).pop()}
        </span>
      </div>
    </div>
  )
})

export function MediaRow({
  title,
  items,
  showRemaining
}: {
  title: string
  items: LibraryItem[]
  showRemaining?: boolean
}): ReactNode {
  if (!items.length) return null
  const queue = items.map((i) => i.id)
  return (
    <section className={styles.row}>
      <div className={styles.rowHead}>
        <h2 className={styles.rowTitle}>{title}</h2>
        <span className={styles.rowCount}>{items.length}</span>
      </div>
      <div className={styles.rowScroll}>
        {items.map((item) => (
          <MediaCard key={item.id} item={item} queue={queue} showRemaining={showRemaining} />
        ))}
      </div>
    </section>
  )
}
