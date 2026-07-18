import { watch, type FSWatcher, promises as fsp } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { JsonStore } from './store'
import { scanFolder, mergeScan, pathId } from './scanner'
import { cleanTitle } from './title'
import { pathGuard } from './protocol'
import { VIDEO_EXTENSIONS, type LibraryItem, type LibraryState, type ScanProgress } from '@shared/types'

const VIDEO_SET = new Set<string>(VIDEO_EXTENSIONS)

type Broadcast = (channel: string, payload: unknown) => void

export class Library {
  private store: JsonStore<LibraryState>
  private watchers = new Map<string, FSWatcher>()
  private watchDebounce = new Map<string, NodeJS.Timeout>()
  private broadcast: Broadcast = () => {}
  private notifyTimer: NodeJS.Timeout | null = null

  constructor(userDataDir: string) {
    this.store = new JsonStore<LibraryState>(join(userDataDir, 'library.json'), {
      revision: 1,
      folders: [],
      items: []
    })
    pathGuard.setRoots(this.state.folders)
    // Loose files added in previous sessions keep streaming rights
    for (const item of this.state.items) pathGuard.allowFileDir(item.path)
  }

  get state(): LibraryState {
    return this.store.get()
  }

  setBroadcast(fn: Broadcast): void {
    this.broadcast = fn
  }

  startWatching(): void {
    for (const f of this.state.folders) this.watchFolder(f)
  }

  /**
   * First-run convenience: index the user's default Videos folder once.
   * Removing it later is respected — we never re-seed.
   */
  async seedDefaultFolder(folder: string): Promise<void> {
    if (this.state.seeded) return
    this.store.update((cur) => ({ ...cur, seeded: true }))
    try {
      await fsp.access(folder)
    } catch {
      return // no Videos folder on this system
    }
    if (this.state.folders.length === 0) {
      await this.addFolder(folder)
    }
  }

  private notifyChanged(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => this.broadcast('library:changed', this.state), 150)
  }

  private progress(p: ScanProgress): void {
    this.broadcast('library:scan-progress', p)
  }

  private watchFolder(folder: string): void {
    if (this.watchers.has(folder)) return
    try {
      const w = watch(folder, { recursive: true }, () => {
        const prev = this.watchDebounce.get(folder)
        if (prev) clearTimeout(prev)
        this.watchDebounce.set(
          folder,
          setTimeout(() => void this.scanOne(folder), 1500)
        )
      })
      w.on('error', () => this.unwatchFolder(folder))
      this.watchers.set(folder, w)
    } catch {
      // network drive or permission issue — watching is best-effort
    }
  }

  private unwatchFolder(folder: string): void {
    this.watchers.get(folder)?.close()
    this.watchers.delete(folder)
  }

  async scanOne(folder: string): Promise<void> {
    this.progress({ folder, scanned: 0, found: 0, done: false })
    const scanned = await scanFolder(folder, (s, f) =>
      this.progress({ folder, scanned: s, found: f, done: false })
    )
    this.store.update((cur) => ({ ...cur, items: mergeScan(cur.items, folder, scanned) }))
    this.progress({ folder, scanned: scanned.length, found: scanned.length, done: true })
    this.notifyChanged()
  }

  async addFolder(folder: string): Promise<LibraryState> {
    if (!this.state.folders.includes(folder)) {
      this.store.update((cur) => ({ ...cur, folders: [...cur.folders, folder] }))
      pathGuard.setRoots(this.state.folders)
      this.watchFolder(folder)
      this.notifyChanged()
      void this.scanOne(folder)
    }
    return this.state
  }

  removeFolder(folder: string): LibraryState {
    this.unwatchFolder(folder)
    const prefix = folder.toLowerCase()
    this.store.update((cur) => ({
      ...cur,
      folders: cur.folders.filter((f) => f !== folder),
      items: cur.items.filter((i) => {
        const p = i.path.toLowerCase()
        return !(p.startsWith(prefix + '\\') || p.startsWith(prefix + '/'))
      })
    }))
    pathGuard.setRoots(this.state.folders)
    this.notifyChanged()
    return this.state
  }

  async rescanAll(): Promise<void> {
    for (const f of this.state.folders) await this.scanOne(f)
  }

  /** Register loose files (drag-drop / dialog / file association). */
  async addPaths(paths: string[]): Promise<LibraryItem[]> {
    const added: LibraryItem[] = []
    for (const p of paths) {
      const ext = extname(p).slice(1).toLowerCase()
      if (!VIDEO_SET.has(ext)) continue
      pathGuard.allowFileDir(p)
      const existing = this.state.items.find((i) => i.path.toLowerCase() === p.toLowerCase())
      if (existing) {
        added.push(existing)
        continue
      }
      try {
        const st = await fsp.stat(p)
        const dir = dirname(p)
        // discover sidecar subtitles for the loose file
        let subtitles: string[] = []
        try {
          const stem = basename(p, extname(p)).toLowerCase()
          const entries = await fsp.readdir(dir)
          subtitles = entries
            .filter((n) => {
              const ne = extname(n).slice(1).toLowerCase()
              return (ne === 'srt' || ne === 'vtt') && n.toLowerCase().startsWith(stem)
            })
            .map((n) => join(dir, n))
        } catch {
          // sidecar discovery is best-effort
        }
        const item: LibraryItem = {
          id: pathId(p),
          path: p,
          fileName: basename(p),
          title: cleanTitle(basename(p)),
          folder: dir,
          ext,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          addedAt: Date.now(),
          favorite: false,
          pinned: false,
          tags: [],
          playCount: 0,
          subtitles
        }
        this.store.update((cur) => ({ ...cur, items: [...cur.items, item] }))
        added.push(item)
      } catch {
        // unreadable path — skip
      }
    }
    if (added.length) this.notifyChanged()
    return added
  }

  updateItem(id: string, patch: Partial<LibraryItem>): void {
    this.store.update((cur) => ({
      ...cur,
      items: cur.items.map((i) => (i.id === id ? { ...i, ...patch, id: i.id, path: i.path } : i))
    }))
  }

  async flush(): Promise<void> {
    await this.store.flush()
  }
}
