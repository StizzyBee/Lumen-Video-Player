import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, X, Play, TriangleAlert, Check } from 'lucide-react'
import { useDownloads, type DownloadJob } from '@/core/store/downloads'
import { usePlayer } from '@/core/store/player'
import { ProgressBar } from '@/components/ui/bits'
import { IconButton } from '@/components/ui/IconButton'
import styles from './downloads.module.css'

function JobCard({ job }: { job: DownloadJob }): ReactNode {
  const cancel = useDownloads((s) => s.cancel)
  const dismiss = useDownloads((s) => s.dismiss)
  const openItem = usePlayer((s) => s.openItem)
  const active = job.status === 'starting' || job.status === 'downloading' || job.status === 'processing'

  const statusLine =
    job.status === 'starting'
      ? job.statusText ?? 'Starting…'
      : job.status === 'downloading'
        ? `${job.percent.toFixed(0)}%`
        : job.status === 'processing'
          ? 'Processing…'
          : job.status === 'done'
            ? 'Added to library'
            : job.status === 'cancelled'
              ? 'Cancelled'
              : job.error ?? 'Failed'

  return (
    <motion.div
      className={styles.card}
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
    >
      <div className={styles.cardIcon}>
        {job.status === 'done' ? <Check size={16} /> : job.status === 'error' ? <TriangleAlert size={16} /> : <Download size={16} />}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle} title={job.url}>{job.title}</div>
        <div className={styles.cardStatus}>{statusLine}</div>
        {active && <ProgressBar fraction={job.percent / 100} />}
      </div>
      <div className={styles.cardActions}>
        {job.status === 'done' && job.item && (
          <IconButton label="Play" onClick={() => job.item && openItem(job.item)}>
            <Play size={15} />
          </IconButton>
        )}
        <IconButton label={active ? 'Cancel download' : 'Dismiss'} onClick={() => (active ? cancel(job.id) : dismiss(job.id))}>
          <X size={15} />
        </IconButton>
      </div>
    </motion.div>
  )
}

/** Bottom-right stack of live/finished download jobs. */
export function DownloadsTray(): ReactNode {
  const jobs = useDownloads((s) => s.jobs)
  if (jobs.length === 0) return null
  return (
    <div className={styles.tray} role="status" aria-label="Downloads">
      <AnimatePresence>
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} />
        ))}
      </AnimatePresence>
    </div>
  )
}
