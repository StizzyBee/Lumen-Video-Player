import { useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { X, Shuffle, Save, Play } from 'lucide-react'
import { usePlayer } from '@/core/store/player'
import { useLibrary } from '@/core/store/library'
import { useUi } from '@/core/store/ui'
import { platform } from '@/core/platform'
import { IconButton } from '@/components/ui/IconButton'
import { formatTime } from '@/core/utils/format'
import { springSoft } from '@/design/motion'
import styles from './PlayerView.module.css'

export function PlaylistDrawer(): ReactNode {
  const queue = usePlayer((s) => s.queue)
  const queueIndex = usePlayer((s) => s.queueIndex)
  const openItem = usePlayer((s) => s.openItem)
  const byId = useLibrary((s) => s.byId)
  const ui = useUi()

  const items = useMemo(() => queue.map((id) => byId.get(id)).filter((i) => !!i), [queue, byId])

  const shuffle = (): void => {
    const s = usePlayer.getState()
    const current = s.queue[s.queueIndex]
    const rest = s.queue.filter((_, i) => i !== s.queueIndex)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    const next = current !== undefined ? [current, ...rest] : rest
    usePlayer.setState({ queue: next, queueIndex: current !== undefined ? 0 : -1 })
    ui.toast({ kind: 'info', title: 'Queue shuffled' }, 1500)
  }

  const saveAsPlaylist = async (): Promise<void> => {
    if (!items.length) return
    const name = `Queue · ${new Date().toLocaleDateString()}`
    await platform.playlists.save({
      id: `pl-${Date.now()}`,
      name,
      itemIds: items.map((i) => i.id),
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    ui.toast({ kind: 'ok', title: 'Saved as playlist', desc: name })
  }

  return (
    <motion.aside
      className={styles.drawer}
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0, transition: { duration: 0.18 } }}
      transition={springSoft}
      aria-label="Queue"
    >
      <div className={styles.drawerHead}>
        <span className={styles.drawerTitle}>Queue · {items.length}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton size="sm" label="Shuffle queue" onClick={shuffle}>
            <Shuffle size={15} />
          </IconButton>
          <IconButton size="sm" label="Save as playlist" onClick={() => void saveAsPlaylist()}>
            <Save size={15} />
          </IconButton>
          <IconButton size="sm" label="Close queue" onClick={() => ui.setPlaylistDrawer(false)}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
      <div className={styles.drawerList}>
        {items.map((item, i) => (
          <button
            key={item.id}
            className={`${styles.drawerItem} ${i === queueIndex ? styles.drawerItemActive : ''}`}
            onClick={() => openItem(item, { queue })}
          >
            <span className={styles.drawerIndex}>{i === queueIndex ? <Play size={12} fill="currentColor" strokeWidth={0} /> : i + 1}</span>
            <span className={styles.drawerName}>{item.title}</span>
            {item.durationSec ? <span className={styles.drawerDur}>{formatTime(item.durationSec)}</span> : null}
          </button>
        ))}
        {!items.length && <div className={styles.drawerEmpty}>Nothing queued — open a video from a folder or playlist to build a queue.</div>}
      </div>
    </motion.aside>
  )
}
