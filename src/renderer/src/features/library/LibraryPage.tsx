import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownWideNarrow, LayoutGrid, List, X, Film, FolderPlus, Heart
} from 'lucide-react'
import type { LibraryItem, LibrarySort } from '@shared/types'
import { useLibrary, sortItems, searchLibrary } from '@/core/store/library'
import { useSettings } from '@/core/store/settings'
import { usePlayer } from '@/core/store/player'
import { useUi } from '@/core/store/ui'
import { platform } from '@/core/platform'
import { hasThumb } from '@/core/thumbs'
import { formatTime, formatBytes, formatDate, resolutionLabel } from '@/core/utils/format'
import { SearchInput, EmptyState } from '@/components/ui/bits'
import { Button } from '@/components/ui/Button'
import { Menu, anchorFromElement, type MenuAnchor } from '@/components/ui/Menu'
import { MediaCard, cardMenuEntries } from '@/components/media/MediaCard'
import { executeCommand } from '@/core/commands'
import styles from './LibraryPage.module.css'

const SORT_LABELS: Record<LibrarySort, string> = {
  addedAt: 'Recently added',
  lastPlayedAt: 'Recently played',
  title: 'Name',
  durationSec: 'Length',
  resolution: 'Resolution',
  folder: 'Folder',
  sizeBytes: 'File size'
}

type ResFilter = 'all' | '4k' | '1440p' | '1080p' | '720p' | 'sd'
const RES_FILTERS: Array<{ id: ResFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: '4k', label: '4K' },
  { id: '1440p', label: '1440p' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: 'sd', label: 'SD' }
]

function matchesRes(item: LibraryItem, f: ResFilter): boolean {
  if (f === 'all') return true
  const h = item.height
  if (!h) return false
  switch (f) {
    case '4k': return h >= 2000
    case '1440p': return h >= 1380 && h < 2000
    case '1080p': return h >= 1000 && h < 1380
    case '720p': return h >= 700 && h < 1000
    case 'sd': return h < 700
  }
}

export function LibraryPage(): ReactNode {
  const view = useUi((s) => s.view)
  const navigate = useUi((s) => s.navigate)
  const items = useLibrary((s) => s.items)
  const ready = useLibrary((s) => s.ready)
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const openItem = usePlayer((s) => s.openItem)

  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [resFilter, setResFilter] = useState<ResFilter>('all')
  const [sortMenu, setSortMenu] = useState<MenuAnchor | null>(null)

  const folder = view.name === 'library' ? view.folder : undefined
  const sort = settings.ui.librarySort
  const mode = settings.ui.libraryView

  const filtered = useMemo(() => {
    let list = items
    if (folder) {
      const prefix = folder.toLowerCase()
      list = list.filter((i) => {
        const p = i.folder.toLowerCase()
        return p === prefix || p.startsWith(prefix + '\\') || p.startsWith(prefix + '/')
      })
    }
    if (favOnly) list = list.filter((i) => i.favorite)
    if (resFilter !== 'all') list = list.filter((i) => matchesRes(i, resFilter))
    if (query.trim()) return searchLibrary(list, query, 200)
    return sortItems(list, sort)
  }, [items, folder, favOnly, resFilter, query, sort])

  const queue = useMemo(() => filtered.map((i) => i.id), [filtered])
  const folderName = folder?.split(/[\\/]/).filter(Boolean).pop()

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{folderName ?? 'Library'}</h1>
        <span className={styles.count}>{filtered.length}</span>
        {folder && (
          <span className={styles.folderChip}>
            {folderName}
            <button aria-label="Clear folder filter" onClick={() => navigate({ name: 'library' })}>
              <X size={13} />
            </button>
          </span>
        )}
        <div className={styles.spacer} />

        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Filter this view"
          aria-label="Filter library"
          wrapStyle={{ width: 230 }}
        />

        <button
          className={styles.sortBtn}
          onClick={(e) => setSortMenu(anchorFromElement(e.currentTarget, 'bottom', 'end'))}
          aria-label="Sort"
        >
          <ArrowDownWideNarrow size={15} />
          {SORT_LABELS[sort]}
        </button>
        <Menu
          open={!!sortMenu}
          anchor={sortMenu}
          onClose={() => setSortMenu(null)}
          entries={(Object.keys(SORT_LABELS) as LibrarySort[]).map((k) => ({
            id: k,
            label: SORT_LABELS[k],
            checked: sort === k,
            onSelect: () => patch({ ui: { librarySort: k } })
          }))}
        />

        <button
          className={`${styles.sortBtn}`}
          style={favOnly ? { color: 'var(--accent)', background: 'var(--accent-soft)', boxShadow: 'none' } : undefined}
          onClick={() => setFavOnly((f) => !f)}
          aria-pressed={favOnly}
        >
          <Heart size={15} fill={favOnly ? 'currentColor' : 'none'} />
          Favorites
        </button>

        <div className={styles.viewToggle} role="radiogroup" aria-label="Resolution filter">
          {RES_FILTERS.map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={resFilter === r.id}
              className={resFilter === r.id ? styles.on : ''}
              style={{ width: 'auto', padding: '0 9px', fontSize: 'var(--fs-micro)', fontWeight: 700 }}
              onClick={() => setResFilter(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className={styles.viewToggle} role="tablist" aria-label="View mode">
          <button className={mode === 'grid' ? styles.on : ''} aria-label="Grid view" onClick={() => patch({ ui: { libraryView: 'grid' } })}>
            <LayoutGrid size={15} />
          </button>
          <button className={mode === 'list' ? styles.on : ''} aria-label="List view" onClick={() => patch({ ui: { libraryView: 'list' } })}>
            <List size={15} />
          </button>
        </div>
      </div>

      {ready && filtered.length === 0 ? (
        query || favOnly ? (
          <EmptyState
            icon={<Film size={36} strokeWidth={1.5} />}
            title="Nothing matches"
            description="Try a different search, or clear the active filters."
          />
        ) : (
          <EmptyState
            icon={<Film size={36} strokeWidth={1.5} />}
            title={folder ? 'No videos in this folder' : 'No videos yet'}
            description="Add a folder to build your library."
            actions={
              <Button variant="primary" icon={<FolderPlus size={17} />} onClick={() => executeCommand('app.addFolder')}>
                Add a folder
              </Button>
            }
          />
        )
      ) : mode === 'grid' ? (
        <div className={styles.grid}>
          {filtered.map((item) => (
            <MediaCard key={item.id} item={item} queue={queue} />
          ))}
        </div>
      ) : (
        <ListView items={filtered} queue={queue} onOpen={openItem} />
      )}
    </div>
  )
}

function ListView({
  items,
  queue,
  onOpen
}: {
  items: LibraryItem[]
  queue: string[]
  onOpen: (item: LibraryItem, opts?: { queue?: string[] }) => void
}): ReactNode {
  const openContextMenu = useUi((s) => s.openContextMenu)
  return (
    <div className={styles.list} role="table" aria-label="Videos">
      <div className={`${styles.listRow} ${styles.listHead}`} role="row">
        <span>Title</span>
        <span>Folder</span>
        <span>Length</span>
        <span>Quality</span>
        <span>Size</span>
        <span>Added</span>
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          className={styles.listRow}
          role="row"
          onClick={() => onOpen(item, { queue })}
          onContextMenu={(e) => {
            e.preventDefault()
            openContextMenu({ x: e.clientX, y: e.clientY }, cardMenuEntries(item, queue))
          }}
        >
          <span className={styles.listTitle}>
            {hasThumb(item) ? (
              <img className={styles.listThumb} src={platform.thumbs.url(item.id)} alt="" loading="lazy" />
            ) : (
              <span className={styles.listThumb} style={{ display: 'grid', placeItems: 'center' }}>
                <Film size={16} strokeWidth={1.5} style={{ color: 'var(--text-3)' }} />
              </span>
            )}
            <span className={styles.listName}>{item.title}</span>
          </span>
          <span className={styles.cellTruncate}>{item.folder.split(/[\\/]/).filter(Boolean).pop()}</span>
          <span className={styles.num}>{item.durationSec ? formatTime(item.durationSec) : '—'}</span>
          <span className={styles.num}>{resolutionLabel(item.width, item.height) ?? '—'}</span>
          <span className={styles.num}>{formatBytes(item.sizeBytes)}</span>
          <span className={styles.num}>{formatDate(item.addedAt)}</span>
        </button>
      ))}
    </div>
  )
}
