import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFolder, mergeScan, pathId, type ScannedFile } from './scanner'
import type { LibraryItem } from '@shared/types'

const BIG = Buffer.alloc(80 * 1024)

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lumen-scan-'))
  mkdirSync(join(root, 'Movies'))
  mkdirSync(join(root, 'Movies', '.hidden'))
  writeFileSync(join(root, 'Movies', 'Film.One.2020.1080p.mkv'), BIG)
  writeFileSync(join(root, 'Movies', 'Film.One.2020.1080p.en.srt'), 'subs')
  writeFileSync(join(root, 'Movies', 'notes.txt'), 'not a video')
  writeFileSync(join(root, 'Movies', 'tiny.mp4'), Buffer.alloc(100)) // stub — skipped
  writeFileSync(join(root, 'Movies', '.hidden', 'secret.mp4'), BIG) // hidden dir file IS scanned (dir not dot-checked for files) — actually dir is dot-prefixed and skipped
  writeFileSync(join(root, 'clip.webm'), BIG)
  writeFileSync(join(root, 'capture.m2ts'), BIG)
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('scanFolder', () => {
  it('finds videos recursively, skips stubs, non-videos and dot-directories', async () => {
    const files = await scanFolder(root)
    const names = files.map((f) => f.fileName).sort()
    expect(names).toEqual(['Film.One.2020.1080p.mkv', 'capture.m2ts', 'clip.webm'])
  })
  it('attaches sidecar subtitles by basename prefix', async () => {
    const files = await scanFolder(root)
    const film = files.find((f) => f.fileName.endsWith('.mkv'))
    expect(film?.subtitles).toHaveLength(1)
    expect(film?.subtitles[0].endsWith('.srt')).toBe(true)
  })
})

function scanned(path: string, over: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path,
    fileName: path.split('\\').pop() ?? path,
    folder: path.slice(0, path.lastIndexOf('\\')),
    ext: 'mp4',
    sizeBytes: 1000,
    mtimeMs: 111,
    subtitles: [],
    ...over
  }
}

function item(path: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: pathId(path),
    path,
    fileName: path.split('\\').pop() ?? path,
    title: 'T',
    folder: path.slice(0, path.lastIndexOf('\\')),
    ext: 'mp4',
    sizeBytes: 1000,
    mtimeMs: 111,
    addedAt: 1,
    favorite: false,
    pinned: false,
    tags: [],
    playCount: 0,
    subtitles: [],
    ...over
  }
}

describe('mergeScan', () => {
  const rootDir = 'D:\\Vids'
  it('adds new files and preserves user state on existing ones', () => {
    const existing = [item('D:\\Vids\\a.mp4', { favorite: true, positionSec: 42, durationSec: 100 })]
    const next = mergeScan(existing, rootDir, [scanned('D:\\Vids\\a.mp4'), scanned('D:\\Vids\\b.mp4')], 999)
    expect(next).toHaveLength(2)
    const a = next.find((i) => i.path.endsWith('a.mp4'))
    expect(a?.favorite).toBe(true)
    expect(a?.positionSec).toBe(42)
    const b = next.find((i) => i.path.endsWith('b.mp4'))
    expect(b?.addedAt).toBe(999)
  })
  it('drops vanished files inside the root but keeps items outside it', () => {
    const existing = [item('D:\\Vids\\gone.mp4'), item('E:\\Other\\keep.mp4')]
    const next = mergeScan(existing, rootDir, [])
    expect(next.map((i) => i.path)).toEqual(['E:\\Other\\keep.mp4'])
  })
  it('invalidates probed metadata when the file changed on disk', () => {
    const existing = [item('D:\\Vids\\a.mp4', { durationSec: 100, thumbReady: true })]
    const next = mergeScan(existing, rootDir, [scanned('D:\\Vids\\a.mp4', { sizeBytes: 2000, mtimeMs: 222 })])
    expect(next[0].durationSec).toBeUndefined()
    expect(next[0].thumbReady).toBe(false)
  })
})
