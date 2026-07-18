// Recursive folder scanning + library diffing. No Electron imports: unit-testable.
import { promises as fsp } from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, type LibraryItem } from '@shared/types'
import { cleanTitle } from './title'

const VIDEO_SET = new Set<string>(VIDEO_EXTENSIONS)
const SUB_SET = new Set<string>(SUBTITLE_EXTENSIONS)
const SKIP_DIRS = new Set(['node_modules', 'System Volume Information', '$RECYCLE.BIN', '$Recycle.Bin'])

export interface ScannedFile {
  path: string
  fileName: string
  folder: string
  ext: string
  sizeBytes: number
  mtimeMs: number
  subtitles: string[]
}

export function pathId(absPath: string): string {
  return createHash('sha1').update(absPath.toLowerCase()).digest('hex')
}

export async function scanFolder(
  root: string,
  onProgress?: (scanned: number, found: number) => void
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = []
  let scanned = 0
  const subsByDir = new Map<string, string[]>()

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory — skip silently
    }
    const files: string[] = []
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) await walk(join(dir, e.name))
      } else if (e.isFile()) {
        files.push(e.name)
      }
    }
    const subs = files.filter((f) => SUB_SET.has(extname(f).slice(1).toLowerCase()))
    if (subs.length) subsByDir.set(dir, subs)
    for (const name of files) {
      const ext = extname(name).slice(1).toLowerCase()
      scanned++
      if (scanned % 200 === 0) onProgress?.(scanned, out.length)
      if (!VIDEO_SET.has(ext)) continue
      const full = join(dir, name)
      try {
        const st = await fsp.stat(full)
        if (st.size < 64 * 1024) continue // ignore stubs/partial downloads
        out.push({
          path: full,
          fileName: name,
          folder: dir,
          ext,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          subtitles: []
        })
      } catch {
        // vanished between readdir and stat — skip
      }
    }
  }

  await walk(root)

  // Attach sidecar subtitles: same directory, name starts with the video's basename
  for (const f of out) {
    const subs = subsByDir.get(f.folder)
    if (!subs) continue
    const stem = basename(f.fileName, extname(f.fileName)).toLowerCase()
    f.subtitles = subs
      .filter((s) => s.toLowerCase().startsWith(stem))
      .map((s) => join(f.folder, s))
  }
  onProgress?.(scanned, out.length)
  return out
}

/** Merge scan results for `root` into the existing item list. Pure. */
export function mergeScan(
  existing: LibraryItem[],
  root: string,
  scanned: ScannedFile[],
  now = Date.now()
): LibraryItem[] {
  const rootPrefix = root.toLowerCase().replace(/[\\/]+$/, '')
  const inRoot = (p: string): boolean => {
    const lower = p.toLowerCase()
    return lower.startsWith(rootPrefix + '\\') || lower.startsWith(rootPrefix + '/') || dirname(lower) === rootPrefix
  }
  const byPath = new Map(existing.map((i) => [i.path.toLowerCase(), i]))
  const seen = new Set<string>()
  const next: LibraryItem[] = []

  for (const f of scanned) {
    const key = f.path.toLowerCase()
    seen.add(key)
    const prev = byPath.get(key)
    if (prev) {
      const changed = prev.sizeBytes !== f.sizeBytes || prev.mtimeMs !== f.mtimeMs
      next.push({
        ...prev,
        sizeBytes: f.sizeBytes,
        mtimeMs: f.mtimeMs,
        subtitles: f.subtitles,
        // file replaced → probed metadata is stale
        ...(changed ? { durationSec: undefined, width: undefined, height: undefined, thumbReady: false } : {})
      })
    } else {
      next.push({
        id: pathId(f.path),
        path: f.path,
        fileName: f.fileName,
        title: cleanTitle(f.fileName),
        folder: f.folder,
        ext: f.ext,
        sizeBytes: f.sizeBytes,
        mtimeMs: f.mtimeMs,
        addedAt: now,
        favorite: false,
        pinned: false,
        tags: [],
        playCount: 0,
        subtitles: f.subtitles
      })
    }
  }

  // Keep items outside this root untouched; drop items inside the root that vanished
  for (const item of existing) {
    const key = item.path.toLowerCase()
    if (!seen.has(key) && !inRoot(item.path)) next.push(item)
  }
  return next
}
