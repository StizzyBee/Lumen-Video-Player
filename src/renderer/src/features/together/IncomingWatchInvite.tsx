import { useEffect, useState, type ReactNode } from 'react'
import { Film, Radio, UserRound } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useTogether } from '@/core/store/together'
import { usePlayer } from '@/core/store/player'
import styles from './IncomingWatchInvite.module.css'

export function IncomingWatchInvite(): ReactNode {
  const invite = useTogether((state) => state.incomingInvite)
  const answer = useTogether((state) => state.answerWatchInvite)
  const hasOpenFilm = usePlayer((state) => state.item !== null)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!invite) return
    const update = (): void => {
      const remaining = Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000))
      setSeconds(remaining)
      if (remaining === 0) void answer(false)
    }
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [answer, invite])

  return (
    <Dialog
      open={!!invite}
      title="Incoming watch invitation"
      onClose={() => void answer(false)}
      actions={
        <>
          <Button variant="ghost" onClick={() => void answer(false)}>Decline</Button>
          <Button variant="primary" onClick={() => void answer(true)}>
            {invite?.mode === 'library' && !hasOpenFilm ? 'Choose film & join' : 'Accept & join'}
          </Button>
        </>
      }
    >
      {invite && (
        <div className={styles.content}>
          <div className={styles.callerIcon}><Film size={28} /></div>
          <div className={styles.caller}>
            <strong>{invite.fromName}</strong>
            <span><UserRound size={13} /> {invite.fromId}</span>
          </div>
          <p className={styles.lead}>wants to watch <strong>{invite.title}</strong> with you.</p>
          <div className={styles.mode}>
            <Radio size={15} />
            <span>
              {invite.mode === 'stream'
                ? 'The film will stream from their PC. You do not need your own copy.'
                : 'Open your copy of the film in Lumen so both players can stay synchronized.'}
            </span>
          </div>
          <div className={styles.expires}>Invitation ends in {seconds}s</div>
        </div>
      )}
    </Dialog>
  )
}
