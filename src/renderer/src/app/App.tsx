import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { ToastHost, ContextMenuHost, ConfirmHost, DropOverlay } from './hosts'
import { HomePage } from '@/features/home/HomePage'
import { LibraryPage } from '@/features/library/LibraryPage'
import { PlaylistsPage } from '@/features/playlists/PlaylistsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { PlayerView } from '@/features/player/PlayerView'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { useSettings } from '@/core/store/settings'
import { useLibrary } from '@/core/store/library'
import { usePlayer } from '@/core/store/player'
import { useUi } from '@/core/store/ui'
import { setupCommands } from './commands-setup'
import { executeCommand } from '@/core/commands'
import { bindingFromEvent, resolveKeymap } from '@/core/shortcuts'
import { platform } from '@/core/platform'
import { kickThumbnailQueue } from '@/core/thumbs'
import { openDroppedFiles } from './openFiles'
import { page } from '@/design/motion'
import styles from './App.module.css'

let booted = false

function boot(): void {
  if (booted) return
  booted = true
  setupCommands()
  void useSettings.getState().init()
  void usePlayer.getState().detectMpv()
  void useLibrary.getState().init().then(() => kickThumbnailQueue())
  useLibrary.subscribe((s, prev) => {
    if (s.items !== prev.items) kickThumbnailQueue()
  })
  useUi.getState().init()

  // File opened via CLI / double-click file association
  void platform.app.getOpenedFile().then((p) => {
    if (p) void usePlayer.getState().openPaths([p])
  })
  platform.app.onOpenFile((p) => void usePlayer.getState().openPaths([p]))
}

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const binding = bindingFromEvent(e)
      if (!binding) return
      const target = e.target instanceof Element ? e.target : null
      const inField = !!target?.closest('input, textarea, select, [contenteditable="true"]')
      if (inField && !binding.startsWith('Ctrl+') && binding !== 'Escape') return
      const keymap = resolveKeymap(useSettings.getState().settings.shortcuts)
      const cmdId = keymap.get(binding)
      if (!cmdId) return
      if (executeCommand(cmdId)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useGlobalDrop(): void {
  const setDropActive = useUi((s) => s.setDropActive)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDropActive(true)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDropActive(false)
      if (e.dataTransfer?.files.length) void openDroppedFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [setDropActive])
}

export function App(): ReactNode {
  const view = useUi((s) => s.view)
  const playerOpen = usePlayer((s) => s.item !== null)

  useEffect(boot, [])
  useGlobalShortcuts()
  useGlobalDrop()

  const browseKey = view.name === 'player' ? 'home' : view.name
  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={browseKey} className={styles.page} {...page}>
              {browseKey === 'home' && <HomePage />}
              {browseKey === 'library' && <LibraryPage />}
              {browseKey === 'playlists' && <PlaylistsPage />}
              {browseKey === 'settings' && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>{playerOpen && <PlayerView />}</AnimatePresence>

      <CommandPalette />
      <ContextMenuHost />
      <ConfirmHost />
      <ToastHost />
      <DropOverlay />
    </div>
  )
}
