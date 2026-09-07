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
  /** "Open URL" dialog: stream or download a video from the web */
  urlDialogOpen: boolean
  playlistDrawerOpen: boolean
  fullscreen: boolean
  miniMode: boolean
  /**
   * The player shrunk to a floating corner card while you browse — the way
   * leaving a video on YouTube keeps it playing rather than stopping it.
   * Distinct from miniMode, which shrinks the whole OS window.
   */
  docked: boolean
  dropActive: boolean
  contextMenu: { anchor: MenuAnchor; entries: MenuEntry[] } | null
  toasts: Toast[]
  confirm: ConfirmState | null

  navigate(view: View): void
  closePlayerView(): void
  setPaletteOpen(open: boolean, seed?: string): void
  setUrlDialog(open: boolean): void
  setPlaylistDrawer(open: boolean): void
  setFullscreen(on: boolean): void
  toggleMiniMode(): void
  setDocked(on: boolean): void
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
  urlDialogOpen: false,
  playlistDrawerOpen: false,
  fullscreen: false,
  miniMode: false,
  docked: false,
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
    // Going back to the player means giving it the whole window again.
    set({ view, contextMenu: null, docked: view.name === 'player' ? false : get().docked })
  },

  setDocked(on) {
    if (on) {
      // Docking is a way of leaving the player without stopping it, so it has
      // to put the browsing UI back where the viewer left it.
      const { fullscreen, lastBrowseView } = get()
      if (fullscreen) get().setFullscreen(false)
      set({ docked: true, view: lastBrowseView, playlistDrawerOpen: false })
    } else {
      set({ docked: false, view: { name: 'player' } })
    }
  },

  closePlayerView() {
    const { fullscreen, miniMode } = get()
    if (fullscreen) get().setFullscreen(false)
    if (miniMode) get().toggleMiniMode()
    set({ view: get().lastBrowseView, playlistDrawerOpen: false, docked: false })
  },

  setPaletteOpen(open, seed = '') {
    set({ paletteOpen: open, paletteSeed: seed })
  },
  setUrlDialog(open) {
    set({ urlDialogOpen: open })
  },
  setPlaylistDrawer(open) {
    set({ playlistDrawerOpen: open })
  },
  setFullscreen(on) {
    // Fullscreen and the floating mini window are mutually exclusive: leave
    // mini first so its always-on-top + 16:9 aspect lock can't constrain the
    // fullscreen window (or linger after leaving it).
    if (on && get().miniMode) get().toggleMiniMode()
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
