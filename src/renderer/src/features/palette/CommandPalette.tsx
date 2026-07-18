import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Search, Terminal, Film, Settings2, CornerDownLeft } from 'lucide-react'
import { useUi } from '@/core/store/ui'
import { useLibrary, recentlyPlayed } from '@/core/store/library'
import { usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { allCommands, executeCommand } from '@/core/commands'
import { DEFAULT_KEYMAP, formatBinding } from '@/core/shortcuts'
import { fuzzyMatch } from '@/core/utils/fuzzy'
import { Kbd } from '@/components/ui/bits'
import { formatTime } from '@/core/utils/format'
import styles from './CommandPalette.module.css'

interface Entry {
  key: string
  icon: ReactNode
  label: string
  positions?: number[]
  hint?: string
  category?: string
  group: string
  run: () => void
}

function highlight(label: string, positions?: number[]): ReactNode {
  if (!positions?.length) return label
  const set = new Set(positions)
  return label.split('').map((c, i) => (set.has(i) ? <b key={i}>{c}</b> : c))
}

export function CommandPalette(): ReactNode {
  const open = useUi((s) => s.paletteOpen)
  const seed = useUi((s) => s.paletteSeed)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const items = useLibrary((s) => s.items)
  const overrides = useSettings((s) => s.settings.shortcuts)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery(seed)
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, seed])

  const bindingFor = (id: string): string | undefined => overrides[id] ?? DEFAULT_KEYMAP[id]

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim()
    const commandsOnly = q.startsWith('>')
    const cq = commandsOnly ? q.slice(1).trim() : q
    const out: Entry[] = []

    const cmdEntries = (limit: number): void => {
      const scored = allCommands()
        .filter((c) => !c.hidden && (!c.when || c.when()))
        .map((c) => ({ c, m: fuzzyMatch(cq, c.title) }))
        .filter((x) => x.m !== null)
        .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
        .slice(0, limit)
      for (const { c, m } of scored) {
        const b = bindingFor(c.id)
        out.push({
          key: `cmd:${c.id}`,
          icon: <Terminal size={16} />,
          label: c.title,
          positions: m?.positions,
          hint: b ? formatBinding(b) : undefined,
          category: c.category,
          group: 'Commands',
          run: () => executeCommand(c.id)
        })
      }
    }

    if (commandsOnly) {
      cmdEntries(40)
      return out
    }

    if (!q) {
      // Zero-query: recent files + starter commands
      const recent = recentlyPlayed(items).slice(0, 5)
      for (const item of recent) {
        out.push({
          key: `file:${item.id}`,
          icon: <Film size={16} />,
          label: item.title,
          hint: item.durationSec ? formatTime(item.durationSec) : undefined,
          group: 'Recent',
          run: () => usePlayer.getState().openItem(item, { queue: recent.map((i) => i.id) })
        })
      }
      for (const id of ['app.openFile', 'app.addFolder', 'app.settings', 'app.palette']) {
        const c = allCommands().find((x) => x.id === id)
        if (!c) continue
        const b = bindingFor(c.id)
        out.push({
          key: `cmd:${c.id}`,
          icon: <Terminal size={16} />,
          label: c.title,
          hint: b ? formatBinding(b) : undefined,
          group: 'Suggested',
          run: () => executeCommand(c.id)
        })
      }
      return out
    }

    // Mixed search: files first, then commands, then settings jumps
    const files = items
      .map((item) => ({ item, m: fuzzyMatch(q, item.title) ?? fuzzyMatch(q, item.fileName) }))
      .filter((x) => x.m !== null)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
      .slice(0, 8)
    const fileQueue = files.map((f) => f.item.id)
    for (const { item, m } of files) {
      out.push({
        key: `file:${item.id}`,
        icon: <Film size={16} />,
        label: item.title,
        positions: m?.positions,
        hint: item.durationSec ? formatTime(item.durationSec) : undefined,
        group: 'Videos',
        run: () => usePlayer.getState().openItem(item, { queue: fileQueue })
      })
    }
    cmdEntries(6)

    const sections = ['Appearance', 'Playback', 'Audio', 'Subtitles', 'Shortcuts', 'Library', 'Privacy']
    for (const s of sections) {
      const m = fuzzyMatch(q, s)
      if (m) {
        out.push({
          key: `set:${s}`,
          icon: <Settings2 size={16} />,
          label: `Settings › ${s}`,
          group: 'Settings',
          run: () => {
            if (usePlayer.getState().item) usePlayer.getState().close()
            useUi.getState().navigate({ name: 'settings', section: s.toLowerCase() })
          }
        })
      }
    }
    return out
  }, [query, items, overrides])

  useEffect(() => setSelected(0), [entries.length, query])

  const close = (): void => setOpen(false)
  const runSelected = (i: number): void => {
    const e = entries[i]
    if (!e) return
    close()
    e.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(entries.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runSelected(selected)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
    e.stopPropagation()
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  let lastGroup = ''

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <motion.div
            className={styles.sheet}
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 600, damping: 42 }}
          >
            <div className={styles.inputRow}>
              <Search size={17} />
              <input
                ref={inputRef}
                value={query}
                placeholder="Search videos and commands — type > for commands only"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
                aria-label="Search"
              />
            </div>
            <div className={styles.results} ref={listRef}>
              {entries.length === 0 && <div className={styles.empty}>No results for “{query}”</div>}
              {entries.map((e, i) => {
                const showGroup = e.group !== lastGroup
                lastGroup = e.group
                return (
                  <div key={e.key}>
                    {showGroup && <div className={styles.group}>{e.group}</div>}
                    <button
                      data-idx={i}
                      className={`${styles.item} ${i === selected ? styles.selected : ''}`}
                      onPointerMove={() => setSelected(i)}
                      onClick={() => runSelected(i)}
                    >
                      <span className={styles.icon}>{e.icon}</span>
                      <span className={styles.label}>{highlight(e.label, e.positions)}</span>
                      {e.category && <span className={styles.cat}>{e.category}</span>}
                      {e.hint && <span className={styles.hintKbd}>{e.hint}</span>}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className={styles.footer}>
              <span><Kbd>↑↓</Kbd> navigate</span>
              <span><Kbd><CornerDownLeft size={10} /></Kbd> open</span>
              <span><Kbd>Esc</Kbd> dismiss</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
