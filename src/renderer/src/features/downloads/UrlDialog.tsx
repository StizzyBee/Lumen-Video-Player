import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, Download, Link2 } from 'lucide-react'
import { useUi } from '@/core/store/ui'
import { usePlayer } from '@/core/store/player'
import { useDownloads } from '@/core/store/downloads'
import { normalizeStreamUrl, isDirectMediaUrl } from '@/core/streams'
import { isDesktop } from '@/core/platform'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import styles from './downloads.module.css'

/**
 * "Open URL" — paste a link, then either stream it right away or download it
 * into the library (yt-dlp). Direct file links stream in the built-in engine;
 * site pages (YouTube etc.) stream through mpv + yt-dlp.
 */
export function UrlDialog(): ReactNode {
  const open = useUi((s) => s.urlDialogOpen)
  const setOpen = useUi((s) => s.setUrlDialog)
  const openUrl = usePlayer((s) => s.openUrl)
  const mpvAvailable = usePlayer((s) => s.mpvAvailable)
  const dl = useDownloads()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      void useDownloads.getState().init()
      // Focus after the dialog's enter animation mounts the input
      window.setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const url = normalizeStreamUrl(value)
  const direct = url ? isDirectMediaUrl(url) : false
  const canStream = !!url && (mpvAvailable || direct)
  const close = (): void => setOpen(false)

  const stream = (): void => {
    if (!url) return
    close()
    openUrl(url)
  }
  const download = (): void => {
    if (!url) return
    close()
    void dl.start(url)
  }

  const hint = !value.trim()
    ? 'Works with direct video links and video pages (YouTube, Vimeo, news sites…).'
    : !url
      ? 'Paste a full http(s) link.'
      : direct
        ? 'Direct video file — streams instantly.'
        : mpvAvailable
          ? dl.ytdlpReady
            ? 'Video page — Lumen resolves it with yt-dlp and plays it in mpv.'
            : 'Video page — streaming it needs the downloader (yt-dlp) installed below.'
          : 'Video pages need the mpv engine (Settings → Video) to stream.'

  return (
    <Dialog
      open={open}
      title="Open a video URL"
      onClose={close}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {isDesktop && (
            dl.ytdlpReady ? (
              <Button variant="subtle" icon={<Download size={15} />} onClick={download} disabled={!url}>
                Download to library
              </Button>
            ) : (
              <Button variant="subtle" icon={<Download size={15} />} onClick={() => void dl.install()} disabled={dl.installing}>
                {dl.installing ? 'Installing downloader…' : 'Install downloader (yt-dlp)'}
              </Button>
            )
          )}
          <Button variant="primary" icon={<Play size={15} />} onClick={stream} disabled={!canStream}>
            Stream now
          </Button>
        </>
      }
    >
      <div className={styles.urlBody}>
        <div className={styles.urlField}>
          <Link2 size={16} />
          <input
            ref={inputRef}
            type="url"
            placeholder="https://…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canStream) stream()
            }}
            aria-label="Video URL"
            spellCheck={false}
          />
        </div>
        <div className={styles.urlHint}>{hint}</div>
        {dl.installing && (
          <div className={styles.urlHint}>{dl.installLog[dl.installLog.length - 1] ?? 'Starting…'}</div>
        )}
        {isDesktop && dl.ytdlpReady && !dl.ffmpegReady && (
          <div className={styles.urlHint}>
            FFmpeg isn't set up, so downloads are capped at the site's pre-merged quality (often 720p). Reinstall the
            downloader to add it.
          </div>
        )}
      </div>
    </Dialog>
  )
}
