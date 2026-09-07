// The watch-party explainer.
//
// Two jobs, in this order: convince someone in one glance that this is worth
// doing, then get them through their first room without a wrong turn. The two
// paths — hosting and joining — are shown side by side because a person always
// knows which of the two they are, and showing only one would leave the other
// half of the pair guessing.

import { type ReactNode } from 'react'
import {
  Copy, Play, Users, ClipboardPaste, Globe, Gavel, Headphones, FileWarning,
  Hourglass, ShieldOff, Wifi, Library, Share2, PictureInPicture2
} from 'lucide-react'
import { Kbd } from '@/components/ui/bits'
import styles from './TogetherGuide.module.css'

/**
 * Two screens far apart showing the same frame, sharing one playhead. Drawn
 * rather than described because "the same moment on both screens" is the whole
 * idea, and a picture carries it faster than a paragraph.
 */
function SyncDiagram(): ReactNode {
  return (
    <svg
      className={styles.diagram}
      viewBox="0 0 420 150"
      role="img"
      aria-label="Two screens in different places showing the same frame, locked to one shared timeline."
    >
      {[0, 260].map((x, i) => (
        <g key={x}>
          <rect
            x={x}
            y="12"
            width="160"
            height="92"
            rx="8"
            fill="var(--bg2)"
            stroke="var(--stroke-strong)"
          />
          {/* The identical frame on both screens. */}
          <rect x={x + 10} y="22" width="140" height="62" rx="4" fill="var(--accent-soft-2)" />
          <circle cx={x + 55} cy="47" r="11" fill="var(--accent)" opacity="0.85" />
          <path d={`M${x + 22} 84 L${x + 62} 58 L${x + 92} 76 L${x + 118} 52 L${x + 138} 70 L${x + 138} 84 Z`} fill="var(--accent)" opacity="0.55" />
          <text x={x + 80} y="122" textAnchor="middle" className={styles.diagramLabel}>
            {i === 0 ? 'You' : 'Your friend'}
          </text>
        </g>
      ))}

      {/* The shared timeline: one playhead, both ends. */}
      <line x1="20" y1="140" x2="400" y2="140" stroke="var(--stroke-strong)" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="140" x2="210" y2="140" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="210" cy="140" r="5" fill="var(--accent)" />

      {/* Distance between them, which the timeline erases. */}
      <path
        d="M170 58 Q210 30 250 58"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        opacity="0.7"
      />
    </svg>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }): ReactNode {
  return (
    <li className={styles.step}>
      <span className={styles.stepNum}>{n}</span>
      <span className={styles.stepBody}>{children}</span>
    </li>
  )
}

function Note({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }): ReactNode {
  return (
    <div className={styles.note}>
      <span className={styles.noteIcon}>{icon}</span>
      <div>
        <div className={styles.noteTitle}>{title}</div>
        <div className={styles.noteBody}>{children}</div>
      </div>
    </div>
  )
}

export function TogetherGuide(): ReactNode {
  return (
    <div className={styles.guide}>
      <p className={styles.lede}>
        Watch the same film with someone anywhere in the world and stay on the same frame the whole way
        through — including the sound. Either everyone plays their own copy, or one of you shares theirs
        with the rest. Nothing is ever uploaded to anyone else&apos;s server.
      </p>

      <SyncDiagram />

      <div className={styles.lanes}>
        <div className={styles.lane}>
          <div className={styles.laneTitle}>
            <Users size={15} /> If you&apos;re starting it
          </div>
          <ol className={styles.steps}>
            <Step n={1}>Open the video you want to watch.</Step>
            <Step n={2}>
              Press <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>W</Kbd>, or click the{' '}
              <Users size={13} className={styles.inlineIcon} /> button in the player controls.
            </Step>
            <Step n={3}>
              Pick <strong>Everyone has the film</strong> if your friends have their own copy, or{' '}
              <strong>Only I have the film</strong> to stream it from your PC.
            </Step>
            <Step n={4}>
              Hit <strong>Copy invite</strong> and send that one line to your friend — any chat app will do.
            </Step>
          </ol>
        </div>

        <div className={styles.lane}>
          <div className={styles.laneTitle}>
            <ClipboardPaste size={15} /> If you were invited
          </div>
          <ol className={styles.steps}>
            <Step n={1}>
              Open your own copy of the film — or skip this if you were told it&apos;s being streamed.
            </Step>
            <Step n={2}>
              Press <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>W</Kbd>.
            </Step>
            <Step n={3}>
              Paste the invite into <strong>Join with an invite</strong>.
            </Step>
            <Step n={4}>
              Press <strong>Join</strong>. You&apos;ll land on whatever frame the room is already showing.
            </Step>
          </ol>
        </div>
      </div>

      <div className={styles.inviteExample}>
        <span className={styles.inviteLabel}>An invite looks like this</span>
        <code className={styles.inviteCode}>100.101.102.103:7345#ABC234</code>
        <span className={styles.inviteHint}>
          <Copy size={12} /> It carries the address and the room code together, so there&apos;s only one
          thing to send and nothing to read out.
        </span>
      </div>

      <h3 className={styles.heading}>Two kinds of room</h3>

      <Note icon={<Library size={15} />} title="Everyone has the film">
        The default. Each person plays their own copy, so nothing is sent between you and any format
        Lumen can open will work. Lumen checks you are all on the same cut and warns if someone is not.
      </Note>

      <Note icon={<Share2 size={15} />} title="Only I have the film">
        Your friends watch straight from your PC — they need no copy, no library, nothing but the
        invite. Two things to know: it uses <strong>your</strong> upload bandwidth, roughly the video&apos;s
        bitrate for each person watching, so one or two friends is realistic on a home connection. And
        guests decode in the browser engine, so stick to <strong>MP4, M4V, WebM or MOV</strong> — Lumen
        warns you if the file you are sharing is something they cannot play.
      </Note>

      <h3 className={styles.heading}>Once you&apos;re in</h3>

      <Note icon={<Play size={15} />} title="Play, pause and seek move everyone">
        Whatever you do to the video happens to the whole room at once. Nobody has to count down or press
        play at the same time — Lumen schedules the start so every screen begins on the same frame.
      </Note>

      <Note icon={<Gavel size={15} />} title="Anyone can pause; resuming can need a vote">
        Pausing is instant and needs nobody&apos;s permission. If someone else paused and the room wants to
        carry on, use <strong>Vote to resume</strong> — it passes on a majority of everyone except the
        person who paused. If somebody keeps disrupting the film, the room can vote to take pause and seek
        away from them for 5 minutes, 10 minutes, or an hour.
      </Note>

      <Note icon={<Hourglass size={15} />} title="The room waits for you">
        If anyone&apos;s video stalls, or somebody new joins, everything pauses until they&apos;re ready and
        then picks up from exactly where it stopped. You never have to hunt for the right spot again.
      </Note>

      <Note icon={<PictureInPicture2 size={15} />} title="Browse without leaving">
        Pressing <strong>Back</strong> during a watch party shrinks the video into a corner instead of
        closing it, so you can search your library or change a setting while the film carries on. Click
        the expand button on the little player to go back to full size.
      </Note>

      <Note icon={<Headphones size={15} />} title="If your sound feels off">
        Bluetooth headphones add up to a third of a second of delay, so the picture can be perfectly in
        sync while your audio lands late. Nudge <strong>Your audio delay</strong> in the panel until
        dialogue matches. It only changes things for you.
      </Note>

      <h3 className={styles.heading}>Watching from far away</h3>

      <Note icon={<Wifi size={15} />} title="Check what the panel says about your invite">
        Under the invite you&apos;ll see either <strong>&ldquo;Reachable anywhere&rdquo;</strong> or{' '}
        <strong>&ldquo;Works on your network only&rdquo;</strong>. The second one means your friend has to be
        in the same house — home internet connections can&apos;t dial each other directly.
      </Note>

      <Note icon={<Globe size={15} />} title="To reach someone in another country">
        In the panel, choose <strong>Install ZeroTier</strong>. It&apos;s free, and Lumen installs it for
        you. Then create a network on the ZeroTier site, and both of you join it using the 16-character
        network ID — there&apos;s a box for it right in the panel. After that your invite works from
        anywhere, with nothing to change on either router.
      </Note>

      <h3 className={styles.heading}>If something looks wrong</h3>

      <div className={styles.faq}>
        <Note icon={<FileWarning size={15} />} title="&ldquo;Different file&rdquo; next to someone's name">
          Their copy has a noticeably different runtime, so the two of you may not be looking at the same
          moment. Usually it&apos;s a different cut or a version with the intro trimmed. Different encodes
          of the same film are fine and won&apos;t be flagged.
        </Note>
        <Note icon={<ShieldOff size={15} />} title="Your controls stopped working">
          The room voted to pause your playback controls for a while. The panel shows how long is left,
          and they come back on their own.
        </Note>
        <Note icon={<Wifi size={15} />} title="Your friend can't connect">
          Check the invite says &ldquo;Reachable anywhere&rdquo;. If it says your network only, set up
          ZeroTier as above. If Windows Firewall asks whether to allow Lumen, say yes.
        </Note>
      </div>
    </div>
  )
}
