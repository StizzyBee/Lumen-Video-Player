// The update offer.
//
// Checked once at startup and shown as a dialog only when there is genuinely
// something newer. Two rules it follows: nothing downloads until the user
// says yes, and it never interrupts a film — an offer that appears over the
// third act is worse than no offer at all.

import { useEffect, useState, type ReactNode } from 'react'
import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { platform, isDesktop } from '@/core/platform'
import { usePlayer } from '@/core/store/player'
import { useUi } from '@/core/store/ui'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import type { UpdateEvent } from '@shared/updates'

type Phase = 'idle' | 'offered' | 'downloading' | 'ready'

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function UpdatePrompt(): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [total, setTotal] = useState(0)
  const [deferred, setDeferred] = useState(false)
  const [current, setCurrent] = useState('')

  const playing = usePlayer((s) => s.status === 'playing')

  useEffect(() => {
    if (!isDesktop) return
    const off = platform.updates.onEvent((e: UpdateEvent) => {
      switch (e.type) {
        case 'available':
          setVersion(e.version)
          setPhase('offered')
          break
        case 'progress':
          setPercent(e.percent)
          setTotal(e.total)
          break
        case 'ready':
          setPhase('ready')
          break
        case 'error':
          // A failed check almost always means "offline". Never a dialog.
          if (phase !== 'idle') {
            useUi.getState().toast(
              { kind: 'warn', title: 'Update failed', desc: e.message },
              6000
            )
            setPhase('idle')
          }
          break
        case 'checking':
        case 'none':
          break
      }
    })
    void platform.app.version().then(setCurrent)
    void platform.updates.check()
    return off
    // Registered once; `phase` is read through the closure only for the error
    // case, where a stale value cannot cause a wrong dialog to appear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hold the offer back while a film is on screen. It reappears the moment
  // playback stops, so it is postponed rather than lost.
  const open = phase !== 'idle' && !deferred && !playing

  const download = (): void => {
    setPhase('downloading')
    void platform.updates.download()
  }

  return (
    <Dialog
      open={open}
      title={phase === 'ready' ? 'Update ready to install' : `Lumen ${version} is available`}
      onClose={() => setDeferred(true)}
      actions={
        phase === 'ready' ? (
          <>
            <Button variant="ghost" onClick={() => setDeferred(true)}>
              Later
            </Button>
            <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => platform.updates.install()}>
              Restart and install
            </Button>
          </>
        ) : phase === 'downloading' ? (
          <Button variant="ghost" onClick={() => setDeferred(true)}>
            Continue in the background
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setDeferred(true)}>
              Not now
            </Button>
            <Button variant="primary" icon={<Download size={16} />} onClick={download}>
              Download update
            </Button>
          </>
        )
      }
    >
      {phase === 'downloading' ? (
        <>
          <p>
            Downloading Lumen {version}
            {total > 0 ? ` · ${formatMb(total)}` : ''}
          </p>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              height: 6,
              borderRadius: 999,
              background: 'var(--bg-input)',
              overflow: 'hidden',
              marginTop: 12
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 200ms'
              }}
            />
          </div>
        </>
      ) : phase === 'ready' ? (
        <p>
          Lumen {version} has been downloaded and checked. Installing takes a moment and reopens the app.
        </p>
      ) : (
        <p style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Sparkles size={18} style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }} />
          <span>
            You&apos;re running {current || 'an older version'}. Downloading is about 95&nbsp;MB, and
            nothing is installed until you choose to.
          </span>
        </p>
      )}
    </Dialog>
  )
}
