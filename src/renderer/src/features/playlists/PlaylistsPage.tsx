import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ListVideo, Plus, Play, Trash2, GripVertical, ChevronLeft, Shuffle, Download, Upload, X
} from 'lucide-react'
import type { Playlist } from '@shared/types'
import { platform, isDesktop } from '@/core/platform'
import { useLibrary } from '@/core/store/library'
import { usePlayer } from '@/core/store/player'
import { useUi } from '@/core/store/ui'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/bits'
import { formatTime } from '@/core/utils/format'
import styles from './PlaylistsPage.module.css'

export function PlaylistsPage(): ReactNode {
  const view = useUi((s) => s.view)
  const navigate = useUi((s) => s.navigate)
  const toast = useUi((s) => s.toast)
  const askConfirm = useUi((s) => s.askConfirm)
  const byId = useLibrary((s) => s.byId)
  const openItem = usePlayer((s) => s.openItem)

  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [nameDialog, setNameDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)

  const refresh = useCallback(async () => {
    setPlaylists(await platform.playlists.list())
  }, [])
  useEffect(() => void refresh(), [refresh])

  const activeId = view.name === 'playlists' ? view.id : undefined
  const active = playlists.find((p) => p.id === activeId)

  const save = async (p: Playlist): Promise<void> => {
    await platform.playlists.save({ ...p, updatedAt: Date.now() })
    await refresh()
  }

  const createPlaylist = async (): Promise<void> => {
    const name = newName.trim() || 'New playlist'
    const p: Playlist = { id: `pl-${Date.now()}`, name, itemIds: [], createdAt: Date.now(), updatedAt: Date.now() }
    await save(p)
    setNameDialog(false)
    setNewName('')
    navigate({ name: 'playlists', id: p.id })
  }

  const playAll = (p: Playlist, shuffle = false): void => {
    const ids = p.itemIds.filter((id) => byId.has(id))
    if (!ids.length) {
      toast({ kind: 'warn', title: 'Playlist has no available videos' })
      return
    }
    const queue = shuffle ? [...ids].sort(() => Math.random() - 0.5) : ids
    const first = byId.get(queue[0])
    if (first) openItem(first, { queue })
  }

  const exportM3u = (p: Playlist): void => {
    const lines = ['#EXTM3U']
    for (const id of p.itemIds) {
      const item = byId.get(id)
      if (!item) continue
      lines.push(`#EXTINF:${item.durationSec ?? -1},${item.title}`)
      lines.push(item.path)
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${p.name.replace(/[<>:"/\\|?*]+/g, '')}.m3u`
    a.click()
    URL.revokeObjectURL(a.href)
    toast({ kind: 'ok', title: 'Playlist exported', desc: `${p.name}.m3u saved to Downloads` })
  }

  const importM3u = async (file: File): Promise<void> => {
    const text = await file.text()
    const paths = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    if (!paths.length) {
      toast({ kind: 'warn', title: 'No entries found in playlist file' })
      return
    }
    const items = await platform.library.addPaths(paths)
    const p: Playlist = {
      id: `pl-${Date.now()}`,
      name: file.name.replace(/\.m3u8?$/i, ''),
      itemIds: items.map((i) => i.id),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await save(p)
    toast({ kind: 'ok', title: 'Playlist imported', desc: `${items.length} of ${paths.length} entries found` })
  }

  // ── detail view ──
  if (active) {
    const items = active.itemIds.map((id) => byId.get(id)).filter((i) => !!i)
    const totalSec = items.reduce((a, i) => a + (i.durationSec ?? 0), 0)

    const reorder = (from: number, to: number): void => {
      const ids = [...active.itemIds]
      const [moved] = ids.splice(from, 1)
      ids.splice(to > from ? to - 1 : to, 0, moved)
      void save({ ...active, itemIds: ids })
    }

    return (
      <div className={styles.page}>
        <div className={styles.detailHead}>
          <IconButton label="All playlists" onClick={() => navigate({ name: 'playlists' })}>
            <ChevronLeft size={20} />
          </IconButton>
          <h1 className={styles.title}>{active.name}</h1>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)', fontWeight: 600 }}>
            {items.length} videos · {formatTime(totalSec)}
          </span>
          <Button variant="primary" size="sm" icon={<Play size={15} fill="currentColor" strokeWidth={0} />} onClick={() => playAll(active)}>
            Play all
          </Button>
          <IconButton label="Shuffle" onClick={() => playAll(active, true)}>
            <Shuffle size={17} />
          </IconButton>
          <IconButton label="Export as M3U" onClick={() => exportM3u(active)}>
            <Download size={17} />
          </IconButton>
          <IconButton
            label="Delete playlist"
            onClick={() =>
              askConfirm({
                title: 'Delete playlist?',
                body: `“${active.name}” will be deleted. Videos stay in your library.`,
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: () => {
                  void platform.playlists.remove(active.id).then(() => {
                    void refresh()
                    navigate({ name: 'playlists' })
                  })
                }
              })
            }
          >
            <Trash2 size={17} />
          </IconButton>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={<ListVideo size={36} strokeWidth={1.5} />}
            title="Empty playlist"
            description="Add videos from the library — right-click any video, or use the queue panel's save button while playing."
          />
        ) : (
          <div className={styles.itemList}>
            {items.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className={[
                  styles.item,
                  drag?.from === i ? styles.dragging : '',
                  drag && drag.over === i && drag.from !== i ? styles.dropBefore : ''
                ].join(' ')}
                draggable
                onDragStart={(e) => {
                  setDrag({ from: i, over: i })
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDrag((d) => (d ? { ...d, over: i } : d))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (drag && drag.from !== i) reorder(drag.from, i)
                  setDrag(null)
                }}
                onDragEnd={() => setDrag(null)}
                onDoubleClick={() => openItem(item, { queue: active.itemIds })}
              >
                <span className={styles.grip}><GripVertical size={15} /></span>
                <span className={styles.itemIdx}>{i + 1}</span>
                <span className={styles.itemTitle}>{item.title}</span>
                <span className={styles.itemDur}>{item.durationSec ? formatTime(item.durationSec) : '—'}</span>
                <IconButton size="sm" label="Play" onClick={() => openItem(item, { queue: active.itemIds })}>
                  <Play size={14} fill="currentColor" strokeWidth={0} />
                </IconButton>
                <IconButton
                  size="sm"
                  label="Remove from playlist"
                  onClick={() => void save({ ...active, itemIds: active.itemIds.filter((_, x) => x !== i) })}
                >
                  <X size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── list view ──
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Playlists</h1>
        {isDesktop && (
          <label>
            <Button variant="ghost" size="sm" icon={<Upload size={15} />} onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement)?.click()}>
              Import M3U
            </Button>
            <input type="file" accept=".m3u,.m3u8" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importM3u(f); e.target.value = '' }} />
          </label>
        )}
        <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setNameDialog(true)}>
          New playlist
        </Button>
      </div>

      {playlists.length === 0 ? (
        <EmptyState
          icon={<ListVideo size={36} strokeWidth={1.5} />}
          title="No playlists yet"
          description="Create a playlist to curate your own lineups — movie marathons, workout mixes, comfort episodes."
          actions={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNameDialog(true)}>
              New playlist
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {playlists.map((p) => (
            <button key={p.id} className={styles.plCard} onClick={() => navigate({ name: 'playlists', id: p.id })}>
              <span className={styles.plIcon}><ListVideo size={22} /></span>
              <span className={styles.plName}>{p.name}</span>
              <span className={styles.plMeta}>{p.itemIds.length} videos</span>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={nameDialog}
        title="New playlist"
        onClose={() => setNameDialog(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setNameDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void createPlaylist()}>Create</Button>
          </>
        }
      >
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createPlaylist() }}
          placeholder="Playlist name"
          aria-label="Playlist name"
          style={{
            width: '100%', height: 38, borderRadius: 'var(--r-md)', border: 'none',
            background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--stroke-strong)',
            padding: '0 12px', fontSize: 'var(--fs-body)'
          }}
        />
      </Dialog>
    </div>
  )
}
