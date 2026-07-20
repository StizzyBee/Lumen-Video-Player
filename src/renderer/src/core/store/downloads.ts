import { create } from 'zustand'
import type { LibraryItem } from '@shared/types'
import { platform } from '@/core/platform'
import { normalizeStreamUrl, streamTitle } from '@/core/streams'
import { usePlayer } from './player'
import { useUi } from './ui'

export interface DownloadJob {
  id: string
  url: string
  title: string
  percent: number
  status: 'starting' | 'downloading' | 'processing' | 'done' | 'error' | 'cancelled'
  statusText?: string
  path?: string
  item?: LibraryItem
  error?: string
}

interface DownloadsStore {
  jobs: DownloadJob[]
  /** null = not probed yet */
  ytdlpReady: boolean | null
  ffmpegReady: boolean
  installing: boolean
  installLog: string[]

  init(): Promise<void>
  /** One-click install of yt-dlp + FFmpeg via winget (mirrors the mpv flow) */
  install(): Promise<boolean>
  start(url: string): Promise<void>
  cancel(id: string): void
  dismiss(id: string): void
}

let subscribed = false

function patchJob(set: (fn: (s: DownloadsStore) => Partial<DownloadsStore>) => void, id: string, patch: Partial<DownloadJob>): void {
  set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }))
}

export const useDownloads = create<DownloadsStore>((set, get) => ({
  jobs: [],
  ytdlpReady: null,
  ffmpegReady: false,
  installing: false,
  installLog: [],

  async init() {
    const paths = await platform.downloads.detect()
    set({ ytdlpReady: !!paths.ytdlp, ffmpegReady: !!paths.ffmpeg })
    if (subscribed) return
    subscribed = true
    platform.downloads.onProgress((e) => {
      if (e.kind === 'progress') {
        patchJob(set, e.id, { status: 'downloading', percent: e.percent ?? 0 })
      } else if (e.kind === 'status') {
        const processing = e.text === 'Processing…'
        patchJob(set, e.id, processing ? { status: 'processing', statusText: e.text } : { statusText: e.text })
      } else if (e.kind === 'done') {
        patchJob(set, e.id, {
          status: 'done',
          percent: 100,
          path: e.path,
          item: e.item,
          title: e.item?.title ?? get().jobs.find((j) => j.id === e.id)?.title ?? e.url
        })
        const item = e.item
        useUi.getState().toast(
          {
            kind: 'ok',
            title: 'Download finished',
            desc: item?.title ?? e.path,
            ...(item ? { action: { label: 'Play', onClick: () => usePlayer.getState().openItem(item) } } : {})
          },
          6000
        )
      } else if (e.kind === 'error') {
        patchJob(set, e.id, { status: 'error', error: e.text ?? 'Download failed' })
      } else if (e.kind === 'cancelled') {
        patchJob(set, e.id, { status: 'cancelled' })
      }
    })
  },

  async install() {
    if (get().installing) return false
    const hasWinget = await platform.downloads.hasWinget()
    if (!hasWinget) {
      useUi.getState().toast(
        { kind: 'warn', title: 'Automatic install needs Windows Package Manager', desc: 'Install yt-dlp manually, then restart Lumen.' },
        4500
      )
      return false
    }
    set({ installing: true, installLog: ['Starting Windows Package Manager…'] })
    const unsub = platform.downloads.onInstallProgress((line) => {
      set((s) => ({ installLog: [...s.installLog, line].slice(-5) }))
    })
    try {
      const res = await platform.downloads.install()
      unsub()
      set({ installing: false, installLog: [] })
      await get().init()
      if (res.ok) {
        useUi.getState().toast({ kind: 'ok', title: 'Downloader ready', desc: 'yt-dlp + FFmpeg installed.' }, 3500)
        return true
      }
      useUi.getState().toast({ kind: 'warn', title: "Couldn't install the downloader", desc: 'Try installing yt-dlp manually.' }, 5000)
      return false
    } catch {
      unsub()
      set({ installing: false })
      useUi.getState().toast({ kind: 'warn', title: 'Downloader install failed' }, 4500)
      return false
    }
  },

  async start(url) {
    const normalized = normalizeStreamUrl(url)
    if (!normalized) {
      useUi.getState().toast({ kind: 'warn', title: "That doesn't look like a video URL" })
      return
    }
    try {
      const { id } = await platform.downloads.start(normalized)
      set((s) => ({
        jobs: [...s.jobs, { id, url: normalized, title: streamTitle(normalized), percent: 0, status: 'starting' as const }]
      }))
    } catch (err) {
      const msg = err instanceof Error && /bad-url/.test(err.message) ? 'Only http(s) links are supported.' : 'Is the downloader installed?'
      useUi.getState().toast({ kind: 'warn', title: "Couldn't start the download", desc: msg })
    }
  },

  cancel(id) {
    platform.downloads.cancel(id)
  },

  dismiss(id) {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  }
}))
