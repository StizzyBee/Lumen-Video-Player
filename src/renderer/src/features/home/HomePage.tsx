import { useMemo, type ReactNode } from 'react'
import { Play, RotateCcw, FolderPlus, FilePlus, Clapperboard, Link2 } from 'lucide-react'
import { useLibrary, continueWatching, recentlyAdded, recentlyPlayed, pinned, favorites } from '@/core/store/library'
import { usePlayer } from '@/core/store/player'
import { platform } from '@/core/platform'
import { hasThumb } from '@/core/thumbs'
import { formatRemaining } from '@/core/utils/format'
import { watchedFraction } from '@/core/resume'
import { Button } from '@/components/ui/Button'
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/bits'
import { MediaRow } from '@/components/media/MediaCard'
import { executeCommand } from '@/core/commands'
import styles from './HomePage.module.css'

function Hero(): ReactNode {
  const items = useLibrary((s) => s.items)
  const openItem = usePlayer((s) => s.openItem)
  const cw = useMemo(() => continueWatching(items), [items])
  const hero = cw[0]
  if (!hero) return null
  const frac = watchedFraction(hero) ?? 0
  const thumb = hasThumb(hero) ? platform.thumbs.url(hero.id) : null
  const queue = cw.map((i) => i.id)

  return (
    <section className={styles.hero} aria-label="Continue watching">
      {thumb && <img className={styles.heroImg} src={thumb} alt="" />}
      <div className={styles.heroScrim} />
      <div className={styles.heroBody}>
        <span className={styles.heroKicker}>Continue watching</span>
        <h1 className={styles.heroTitle}>{hero.title}</h1>
        {hero.positionSec && hero.durationSec ? (
          <span className={styles.heroMeta}>{formatRemaining(hero.positionSec, hero.durationSec)}</span>
        ) : null}
        <div className={styles.heroActions}>
          <Button
            variant="primary"
            size="lg"
            icon={<Play size={18} fill="currentColor" strokeWidth={0} />}
            onClick={() => openItem(hero, { queue })}
          >
            Resume
          </Button>
          <Button
            variant="subtle"
            size="lg"
            icon={<RotateCcw size={17} />}
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', boxShadow: 'none' }}
            onClick={() => openItem(hero, { queue, startOver: true })}
          >
            Start over
          </Button>
        </div>
        <div className={styles.heroProgress}>
          <ProgressBar fraction={frac} />
        </div>
      </div>
    </section>
  )
}

function HomeSkeleton(): ReactNode {
  return (
    <>
      <Skeleton style={{ minHeight: 300, borderRadius: 'var(--r-xl)' }} />
      {[0, 1].map((r) => (
        <div key={r} className={styles.skelRow}>
          <Skeleton style={{ width: 180, height: 22 }} />
          <div className={styles.skelCards}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton style={{ aspectRatio: '16/9' }} />
                <Skeleton style={{ height: 14, width: '70%' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function HomePage(): ReactNode {
  const items = useLibrary((s) => s.items)
  const ready = useLibrary((s) => s.ready)

  const cw = useMemo(() => continueWatching(items), [items])
  const added = useMemo(() => recentlyAdded(items), [items])
  const played = useMemo(() => recentlyPlayed(items), [items])
  const pins = useMemo(() => pinned(items), [items])
  const favs = useMemo(() => favorites(items), [items])

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Late night session' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className={styles.page}>
      {!ready ? (
        <HomeSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Clapperboard size={40} strokeWidth={1.5} />}
          title="Your library is empty"
          description="Add a folder and Lumen will index every video in it — thumbnails, resume positions, search, the lot. Or just drop a file anywhere in this window."
          actions={
            <>
              <Button variant="primary" icon={<FolderPlus size={17} />} onClick={() => executeCommand('app.addFolder')}>
                Add a folder
              </Button>
              <Button variant="subtle" icon={<FilePlus size={17} />} onClick={() => executeCommand('app.openFile')}>
                Open a file
              </Button>
              <Button variant="subtle" icon={<Link2 size={17} />} onClick={() => executeCommand('app.openUrl')}>
                Open a URL
              </Button>
            </>
          }
        />
      ) : (
        <>
          <h1 className={styles.greeting}>{greeting}</h1>
          <Hero />
          {cw.length > 1 && <MediaRow title="Continue watching" items={cw.slice(1)} showRemaining />}
          <MediaRow title="Recently added" items={added} />
          <MediaRow title="Pinned" items={pins} />
          <MediaRow title="Favorites" items={favs} />
          <MediaRow title="Recently played" items={played} />
        </>
      )}
    </div>
  )
}
