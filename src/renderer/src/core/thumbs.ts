// Background probe + thumbnail pipeline. Idle-scheduled, bounded concurrency,
// never blocks the UI. Duration/dimensions come from <video> metadata; thumbs
// are a frame at ~12% drawn to canvas and cached to disk by the main process.
import { platform, isDesktop } from '@/core/platform'
import { setVideoSource } from '@/core/media'
import { memThumbs } from '@/core/platform.mock'
import { useLibrary } from '@/core/store/library'
import type { LibraryItem } from '@shared/types'

/** Whether a usable thumbnail exists right now (mock thumbs are session-only) */
export function hasThumb(item: LibraryItem): boolean {
  return isDesktop ? !!item.thumbReady : memThumbs.has(item.id)
}

const PROBE_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'])
const inFlight = new Set<string>()
const failed = new Set<string>()
let running = false

export function kickThumbnailQueue(): void {
  if (running) return
  running = true
  void pump().finally(() => {
    running = false
  })
}

function nextCandidate(): LibraryItem | null {
  const { items } = useLibrary.getState()
  for (const item of items) {
    if (inFlight.has(item.id) || failed.has(item.id)) continue
    if (!PROBE_EXT.has(item.ext)) continue
    if (item.durationSec === undefined || !hasThumb(item)) return item
  }
  return null
}

async function pump(): Promise<void> {
  for (;;) {
    const item = nextCandidate()
    if (!item) return
    inFlight.add(item.id)
    try {
      await processItem(item)
    } catch {
      failed.add(item.id)
    } finally {
      inFlight.delete(item.id)
    }
    // yield to the UI between items
    await new Promise((r) => setTimeout(r, 120))
  }
}

function processItem(item: LibraryItem): Promise<void> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    let settled = false
    const timeout = window.setTimeout(() => finish(new Error('timeout')), 20000)

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      v.removeAttribute('src')
      v.load()
      if (err) reject(err)
      else resolve()
    }

    v.addEventListener('error', () => finish(new Error('media error')))

    // Streaming-style files report duration=Infinity until a far seek resolves it
    let proceeded = false
    let resolvingDuration = false
    const proceed = (): void => {
      if (proceeded) return
      proceeded = true
      const patch: Partial<LibraryItem> = {}
      if (Number.isFinite(v.duration) && v.duration > 0) patch.durationSec = Math.round(v.duration)
      if (v.videoWidth) {
        patch.width = v.videoWidth
        patch.height = v.videoHeight
      }
      if (Object.keys(patch).length) useLibrary.getState().patchItem(item.id, patch)
      if (hasThumb(item)) {
        finish()
        return
      }
      const target = Number.isFinite(v.duration) ? Math.min(v.duration * 0.12, 180) : 3
      v.currentTime = Math.max(0.1, target)
    }
    v.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(v.duration)) {
        resolvingDuration = true
        v.currentTime = 1e10
        return
      }
      proceed()
    })
    v.addEventListener('durationchange', () => {
      if (resolvingDuration && Number.isFinite(v.duration) && v.duration > 0) {
        resolvingDuration = false
        proceed()
      }
    })

    v.addEventListener('seeked', () => {
      if (!proceeded) return // resolution seek, not the thumbnail seek
      try {
        if (!v.videoWidth) {
          finish()
          return
        }
        const canvas = document.createElement('canvas')
        const w = 480
        canvas.width = w
        canvas.height = Math.round((w * v.videoHeight) / v.videoWidth)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finish()
          return
        }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        memThumbs.set(item.id, dataUrl)
        void platform.thumbs
          .save(item.id, dataUrl)
          .then(() => useLibrary.getState().patchItem(item.id, { thumbReady: true }))
          .finally(() => finish())
      } catch {
        // tainted canvas (browser mock remote samples): metadata still probed
        finish()
      }
    })

    setVideoSource(v, platform.media.url(item.path))
  })
}
