import { create } from 'zustand'
import type { LibraryItem, LibraryState, LibrarySort, ScanProgress } from '@shared/types'
import { platform } from '@/core/platform'
import { isResumable } from '@/core/resume'
import { fuzzyFilter } from '@/core/utils/fuzzy'

interface LibraryStore {
  folders: string[]
  items: LibraryItem[]
  byId: Map<string, LibraryItem>
  ready: boolean
  scanning: ScanProgress | null
  init(): Promise<void>
  refresh(state: LibraryState): void
  addFolder(): Promise<void>
  removeFolder(folder: string): Promise<void>
  rescan(): Promise<void>
  patchItem(id: string, patch: Partial<LibraryItem>): void
  toggleFavorite(id: string): void
  togglePinned(id: string): void
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  folders: [],
  items: [],
  byId: new Map(),
  ready: false,
  scanning: null,

  async init() {
    const state = await platform.library.getState()
    get().refresh(state)
    set({ ready: true })
    platform.library.onChanged((s) => get().refresh(s))
    platform.library.onScanProgress((p) => set({ scanning: p.done ? null : p }))
  },

  refresh(state) {
    set({
      folders: state.folders,
      items: state.items,
      byId: new Map(state.items.map((i) => [i.id, i]))
    })
  },

  async addFolder() {
    const res = await platform.library.addFolder()
    if (res) get().refresh(res)
  },

  async removeFolder(folder) {
    const res = await platform.library.removeFolder(folder)
    get().refresh(res)
  },

  async rescan() {
    await platform.library.rescan()
  },

  patchItem(id, patch) {
    // Optimistic local update; main persists (no echo event for item patches)
    set((s) => {
      const items = s.items.map((i) => (i.id === id ? { ...i, ...patch } : i))
      return { items, byId: new Map(items.map((i) => [i.id, i])) }
    })
    void platform.library.updateItem(id, patch)
  },

  toggleFavorite(id) {
    const item = get().byId.get(id)
    if (item) get().patchItem(id, { favorite: !item.favorite })
  },
  togglePinned(id) {
    const item = get().byId.get(id)
    if (item) get().patchItem(id, { pinned: !item.pinned })
  }
}))

// ── Derived rows (pure helpers used with useMemo in views) ──────────────────

export function continueWatching(items: LibraryItem[]): LibraryItem[] {
  return items
    .filter(isResumable)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, 12)
}

export function recentlyAdded(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => b.addedAt - a.addedAt).slice(0, 16)
}

export function recentlyPlayed(items: LibraryItem[]): LibraryItem[] {
  return items
    .filter((i) => i.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, 16)
}

export function pinned(items: LibraryItem[]): LibraryItem[] {
  return items.filter((i) => i.pinned)
}

export function favorites(items: LibraryItem[]): LibraryItem[] {
  return items.filter((i) => i.favorite)
}

export function sortItems(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const arr = [...items]
  switch (sort) {
    case 'addedAt':
      return arr.sort((a, b) => b.addedAt - a.addedAt)
    case 'lastPlayedAt':
      return arr.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case 'durationSec':
      return arr.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))
    case 'resolution':
      return arr.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
    case 'folder':
      return arr.sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title))
    case 'sizeBytes':
      return arr.sort((a, b) => b.sizeBytes - a.sizeBytes)
  }
}

export function searchLibrary(items: LibraryItem[], query: string, limit = 40): LibraryItem[] {
  return fuzzyFilter(query, items, (i) => [i.title, i.fileName, i.folder, ...i.tags], limit).map((r) => r.item)
}
