import { create } from 'zustand'
import type { ReactNode } from 'react'
import { platform, isDesktop } from '@/core/platform'
import type { MenuAnchor, MenuEntry } from '@/components/ui/Menu'

export type View =
  | { name: 'home' }
  | { name: 'library'; folder?: string }
  | { name: 'playlists'; id?: string }
  | { name: 'settings'; section?: string }
  | { name: 'player' }

export interface Toast {
  id: number
  title: string
  desc?: string
  kind: 'info' | 'ok' | 'warn' | 'danger'
  icon?: ReactNode
  action?: { label: string; onClick: () => void }
}

interface ConfirmState {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

interface UiStore {
  view: View
  lastBrowseView: View
  paletteOpen: boolean
  paletteSeed: string
  playlistDrawerOpen: boolean
  fullscreen: boolean
  miniMode: boolean
  dropActive: boolean
  contextMenu: { anchor: MenuAnchor; entries: MenuEntry[] } | null
  toasts: Toast[]
  confirm: ConfirmState | null

  navigate(view: View): void
  closePlayerView(): void
  setPaletteOpen(open: boolean, seed?: string): void
  setPlaylistDrawer(open: boolean): void
  setFullscreen(on: boolean): void
  toggleMiniMode(): void
  setDropActive(on: boolean): void
  openContextMenu(anchor: MenuAnchor, entries: MenuEntry[]): void
  closeContextMenu(): void
  toast(t: Omit<Toast, 'id'>, ttlMs?: number): void
  dismissToast(id: number): void
  askConfirm(c: ConfirmState): void
  closeConfirm(): void
  init(): void
}

let toastSeq = 1

export const useUi = create<UiStore>((set, get) => ({
  view: { name: 'home' },
  lastBrowseView: { name: 'home' },
  paletteOpen: false,
  paletteSeed: '',
  playlistDrawerOpen: false,
  fullscreen: false,
  miniMode: false,
  dropActive: false,
  contextMenu: null,
  toasts: [],
  confirm: null,

  init() {
    platform.win.onFullscreen((fs) => set({ fullscreen: fs }))
  },

  navigate(view) {
    const cur = get().view
    if (cur.name !== 'player' && cur.name !== 'settings') set({ lastBrowseView: cur })
    set({ view, contextMenu: null })
  },

  closePlayerView() {
    const { fullscreen, miniMode } = get()
    if (fullscreen) get().setFullscreen(false)
    if (miniMode) get().toggleMiniMode()
    set({ view: get().lastBrowseView, playlistDrawerOpen: false })
  },

  setPaletteOpen(open, seed = '') {
    set({ paletteOpen: open, paletteSeed: seed })
  },
  setPlaylistDrawer(open) {
    set({ playlistDrawerOpen: open })
  },
  setFullscreen(on) {
    platform.win.setFullscreen(on)
    // Browser mock fires the event; Electron fires via main. Optimistic set for
    // instant chrome response either way:
    set({ fullscreen: on })
  },
  toggleMiniMode() {
    const next = !get().miniMode
    platform.win.setMiniMode(next)
    set({ miniMode: next })
    if (!isDesktop) {
      // no real window to shrink in the browser — still useful for styling review
      document.documentElement.dataset.mini = next ? 'true' : 'false'
    }
  },
  setDropActive(on) {
    set({ dropActive: on })
  },
  openContextMenu(anchor, entries) {
    set({ contextMenu: { anchor, entries } })
  },
  closeContextMenu() {
    set({ contextMenu: null })
  },
  toast(t, ttlMs = 4200) {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    window.setTimeout(() => get().dismissToast(id), ttlMs)
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  askConfirm(c) {
    set({ confirm: c })
  },
  closeConfirm() {
    set({ confirm: null })
  }
}))
