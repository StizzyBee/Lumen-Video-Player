import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  Home, LibraryBig, ListVideo, Settings, Folder, FolderPlus,
  PanelLeftClose, PanelLeftOpen, Loader2
} from 'lucide-react'
import { useUi, type View } from '@/core/store/ui'
import { useLibrary } from '@/core/store/library'
import { useSettings } from '@/core/store/settings'
import { usePlayer } from '@/core/store/player'
import { spring } from '@/design/motion'
import { Tooltip } from '@/components/ui/Tooltip'
import styles from './Sidebar.module.css'

function NavItem({
  icon,
  label,
  active,
  onClick,
  collapsed
}: {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
  collapsed: boolean
}): ReactNode {
  const btn = (
    <button className={`${styles.item} ${active ? styles.active : ''}`} onClick={onClick} aria-current={active}>
      {active && <motion.div layoutId="nav-pill" className={styles.pill} transition={spring} />}
      {icon}
      <span>{label}</span>
    </button>
  )
  return collapsed ? (
    <Tooltip label={label} side="top" delay={300}>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
}

export function Sidebar(): ReactNode {
  const view = useUi((s) => s.view)
  const navigate = useUi((s) => s.navigate)
  const folders = useLibrary((s) => s.folders)
  const scanning = useLibrary((s) => s.scanning)
  const addFolder = useLibrary((s) => s.addFolder)
  const collapsed = useSettings((s) => s.settings.ui.sidebarCollapsed)
  const patch = useSettings((s) => s.patch)

  const go = (v: View): void => {
    const p = usePlayer.getState()
    if (p.item) p.close()
    navigate(v)
  }

  const isLibraryFolder = (f: string): boolean => view.name === 'library' && view.folder === f

  return (
    <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`} aria-label="Navigation">
      <NavItem icon={<Home size={18} strokeWidth={1.9} />} label="Home" collapsed={collapsed}
        active={view.name === 'home'} onClick={() => go({ name: 'home' })} />
      <NavItem icon={<LibraryBig size={18} strokeWidth={1.9} />} label="Library" collapsed={collapsed}
        active={view.name === 'library' && !view.folder} onClick={() => go({ name: 'library' })} />
      <NavItem icon={<ListVideo size={18} strokeWidth={1.9} />} label="Playlists" collapsed={collapsed}
        active={view.name === 'playlists'} onClick={() => go({ name: 'playlists' })} />
      <NavItem icon={<Settings size={18} strokeWidth={1.9} />} label="Settings" collapsed={collapsed}
        active={view.name === 'settings'} onClick={() => go({ name: 'settings' })} />

      <div className={styles.sectionLabel}>
        Folders
        {scanning && <Loader2 size={12} className={styles.spin} aria-label="Scanning" />}
      </div>

      <div className={styles.folderList}>
        {folders.map((f) => {
          const name = f.split(/[\\/]/).filter(Boolean).pop() ?? f
          return (
            <NavItem
              key={f}
              icon={<Folder size={17} strokeWidth={1.9} />}
              label={name}
              collapsed={collapsed}
              active={isLibraryFolder(f)}
              onClick={() => go({ name: 'library', folder: f })}
            />
          )
        })}
        <button className={styles.item} onClick={() => void addFolder()}>
          <FolderPlus size={17} strokeWidth={1.9} />
          <span>Add folder</span>
        </button>
      </div>

      <div className={styles.footer}>
        <button
          className={styles.item}
          onClick={() => patch({ ui: { sidebarCollapsed: !collapsed } })}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.9} /> : <PanelLeftClose size={18} strokeWidth={1.9} />}
          <span>Collapse</span>
        </button>
      </div>
    </nav>
  )
}
