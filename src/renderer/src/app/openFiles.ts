// Shared entry point for files arriving via drag-drop.
// Desktop: resolve real paths through the preload bridge.
// Browser preview: play videos via ephemeral blob-URL items.
import { VIDEO_EXTENSIONS, type LibraryItem } from '@shared/types'
import { platform, isDesktop } from '@/core/platform'
import { usePlayer } from '@/core/store/player'
import { useUi } from '@/core/store/ui'

const SUB_RE = /\.(srt|vtt)$/i
const VIDEO_SET = new Set<string>(VIDEO_EXTENSIONS)

export function isVideoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && VIDEO_SET.has(name.slice(dot + 1).toLowerCase())
}

export async function openDroppedFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files)
  if (!list.length) return
  const player = usePlayer.getState()

  // Subtitle files attach to the playing video
  const subs = list.filter((f) => SUB_RE.test(f.name))
  if (subs.length && player.item) {
    for (const f of subs) {
      const text = await f.text()
      player.addSubtitleFromText(f.name.replace(SUB_RE, '').split(/[\\/]/).pop() ?? f.name, text)
    }
    useUi.getState().toast({ kind: 'ok', title: subs.length > 1 ? `${subs.length} subtitle tracks added` : 'Subtitles added' })
  }

  const videos = list.filter((f) => isVideoFileName(f.name))
  if (!videos.length) {
    if (!subs.length) useUi.getState().toast({ kind: 'warn', title: 'No playable videos in the drop' })
    return
  }

  if (isDesktop) {
    const paths = videos.map((f) => platform.media.pathForFile(f)).filter(Boolean)
    if (paths.length) await player.openPaths(paths)
    return
  }

  // Browser: ephemeral items around object URLs (not persisted)
  const items: LibraryItem[] = videos.map((f, i) => ({
    id: `drop:${f.name}:${i}`,
    path: URL.createObjectURL(f),
    fileName: f.name,
    title: f.name.replace(/\.[^.]+$/, ''),
    folder: 'Dropped files',
    ext: (f.name.split('.').pop() ?? '').toLowerCase(),
    sizeBytes: f.size,
    mtimeMs: f.lastModified,
    addedAt: Date.now(),
    favorite: false,
    pinned: false,
    tags: [],
    playCount: 0,
    subtitles: []
  }))
  usePlayer.getState().openItem(items[0], { queue: [] })
}
