// The watch-party panel: who is here, how tightly everyone is locked to the
// same frame, the votes that decide when a pause may end, and — because NAT is
// the real obstacle to watching with someone far away — the mesh VPN setup
// that makes an invite reach another continent.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  X, Users, Copy, Check, Radio, Gavel, ThumbsUp, ThumbsDown, ShieldOff,
  Crown, WifiOff, FileWarning, Headphones, Pause, Hourglass, Globe, House,
  Download, ExternalLink, CircleQuestionMark, ClipboardPaste, Library, Share2
} from 'lucide-react'
import { useTogether } from '@/core/store/together'
import { useSettings } from '@/core/store/settings'
import { useUi } from '@/core/store/ui'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { Slider } from '@/components/ui/Slider'
import { Dialog } from '@/components/ui/Dialog'
import { TogetherGuide } from './TogetherGuide'
import { REVOKE_DURATIONS, isRestricted, type Ballot, type Member } from '@shared/together/protocol'
import { ZEROTIER_NETWORK_RE, formatInvite, parseInvite, type MeshProvider } from '@shared/together/mesh'
import { tally } from '@shared/together/room'
import { springSoft } from '@/design/motion'
import styles from './TogetherPanel.module.css'

function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

function providerName(provider: MeshProvider | null): string {
  if (!provider) return 'this network'
  const names: Record<MeshProvider, string> = {
    zerotier: 'ZeroTier',
    tailscale: 'Tailscale',
    hamachi: 'Hamachi',
    radmin: 'Radmin VPN',
    wireguard: 'WireGuard'
  }
  return names[provider] ?? 'a mesh VPN'
}

// ── Sync readout ────────────────────────────────────────────────────────────

function SyncBadge(): ReactNode {
  const quality = useTogether((s) => s.quality)
  const driftMs = useTogether((s) => s.driftMs)
  const settled = useTogether((s) => s.clockSettled)
  const rttMs = useTogether((s) => s.rttMs)

  if (!settled) {
    return (
      <div className={`${styles.badge} ${styles.badgeWait}`}>
        <Hourglass size={13} />
        Measuring the connection…
      </div>
    )
  }

  const label =
    quality === 'locked'
      ? 'In sync'
      : quality === 'close'
        ? 'Nearly locked'
        : quality === 'drifting'
          ? 'Catching up'
          : 'Re-syncing'

  return (
    <div className={`${styles.badge} ${styles[`badge_${quality}`] ?? ''}`}>
      <Radio size={13} />
      <span>{label}</span>
      <span className={styles.badgeNum}>
        {driftMs > 0 ? '+' : ''}
        {driftMs} ms
      </span>
      <span className={styles.badgeDim}>· {Math.round(rttMs)} ms ping</span>
    </div>
  )
}

// ── Mesh VPN setup ──────────────────────────────────────────────────────────

/**
 * The NAT answer. Two home connections cannot dial each other, and telling
 * people to forward a port is where watch parties die. A mesh VPN gives both
 * machines an address that works from anywhere; this walks through installing
 * and joining one without ever leaving Lumen.
 */
function MeshSetup({ compact = false }: { compact?: boolean }): ReactNode {
  const mesh = useTogether((s) => s.mesh)
  const meshInstalling = useTogether((s) => s.meshInstalling)
  const meshLog = useTogether((s) => s.meshLog)
  const installMesh = useTogether((s) => s.installMesh)
  const joinZeroTier = useTogether((s) => s.joinZeroTier)
  const openMeshSetup = useTogether((s) => s.openMeshSetup)
  const refreshMesh = useTogether((s) => s.refreshMesh)

  const [networkId, setNetworkId] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    void refreshMesh()
  }, [refreshMesh])

  const hasZeroTier = !!mesh?.installed.includes('zerotier')
  const hasTailscale = !!mesh?.installed.includes('tailscale')
  const ready = !!mesh?.ready

  // Inside the hosting card this section only earns its space when there is
  // something to fix.
  if (ready && compact) return null

  const join = async (): Promise<void> => {
    setJoining(true)
    try {
      if (await joinZeroTier(networkId)) setNetworkId('')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className={compact ? styles.meshCompact : styles.section}>
      <div className={styles.sectionTitle}>
        <Globe size={13} /> Watching from far away
      </div>

      {ready ? (
        <p className={styles.help}>A mesh VPN is connected, so your invite reaches friends anywhere.</p>
      ) : (
        <p className={styles.help}>
          Home internet connections cannot dial each other directly. A free mesh VPN gives both PCs an
          address that works from anywhere — no port forwarding, no router settings.
        </p>
      )}

      {meshInstalling ? (
        <div className={styles.installLog}>{meshLog[meshLog.length - 1] ?? 'Installing…'}</div>
      ) : ready ? null : (
        <>
          {!hasZeroTier && !hasTailscale && (
            <div className={styles.meshButtons}>
              <Button variant="primary" icon={<Download size={15} />} onClick={() => void installMesh('zerotier')}>
                Install ZeroTier
              </Button>
              <Button variant="ghost" onClick={() => void installMesh('tailscale')}>
                Use Tailscale instead
              </Button>
            </div>
          )}

          {hasZeroTier && (
            <>
              <p className={styles.help}>
                ZeroTier is installed. Create a free network, then join it here with its 16-character ID.
              </p>
              <input
                className={styles.input}
                value={networkId}
                placeholder="8056c2e21c000001"
                maxLength={16}
                spellCheck={false}
                onChange={(e) => setNetworkId(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ZEROTIER_NETWORK_RE.test(networkId)) void join()
                }}
              />
              <div className={styles.meshButtons}>
                <Button
                  variant="primary"
                  disabled={!ZEROTIER_NETWORK_RE.test(networkId) || joining}
                  onClick={() => void join()}
                >
                  {joining ? 'Joining…' : 'Join network'}
                </Button>
                <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={() => openMeshSetup('zerotier')}>
                  Get a network ID
                </Button>
              </div>
              <p className={styles.help}>
                Joining needs administrator approval, so Windows will ask. Afterwards, authorize this PC on the
                ZeroTier site — both watchers must be on the same network.
              </p>
            </>
          )}

          {hasTailscale && !hasZeroTier && (
            <div className={styles.meshButtons}>
              <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={() => openMeshSetup('tailscale')}>
                Sign in to Tailscale
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Not in a room yet ───────────────────────────────────────────────────────

function StartPanel({ onShowGuide }: { onShowGuide: () => void }): ReactNode {
  const together = useTogether()
  const settings = useSettings((s) => s.settings.together)
  const clipboardInvite = useTogether((s) => s.clipboardInvite)
  const checkClipboard = useTogether((s) => s.checkClipboard)
  const [invite, setInvite] = useState(settings.lastRelayUrl)
  const [busy, setBusy] = useState(false)

  // Someone who was just sent an invite almost certainly has it on the
  // clipboard. Offering it directly turns joining into a single click.
  useEffect(() => {
    void checkClipboard()
  }, [checkClipboard])

  // One field: the invite token carries both the address and the room code, so
  // there is no way to get one right and the other wrong.
  const parsed = parseInvite(invite)

  const join = async (): Promise<void> => {
    setBusy(true)
    try {
      if (!(await together.joinInvite(invite))) {
        useUi.getState().toast(
          {
            kind: 'warn',
            title: "That invite doesn't look right",
            desc: 'It should look like 100.101.102.103:7345#ABC234'
          },
          5000
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.start}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Your name</div>
        <input
          className={styles.input}
          value={settings.displayName}
          placeholder="Watcher"
          maxLength={24}
          onChange={(e) => together.setDisplayName(e.target.value)}
        />
      </div>

      {clipboardInvite && (
        <div className={styles.clipCard}>
          <div className={styles.clipTitle}>
            <ClipboardPaste size={15} />
            You have an invite ready
          </div>
          <code className={styles.clipCode}>{clipboardInvite.roomId}</code>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void together
                .join(clipboardInvite.url, clipboardInvite.roomId)
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Joining…' : `Join room ${clipboardInvite.roomId}`}
          </Button>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Host a watch party</div>
        <p className={styles.help}>Lumen runs the room on this PC and gives you one line to share.</p>

        <button className={styles.modeCard} onClick={() => void together.host('library')}>
          <Library size={17} />
          <span>
            <strong>Everyone has the film</strong>
            <span className={styles.modeDesc}>
              Each of you plays your own copy. Nothing is uploaded, and it works with any format Lumen
              can open.
            </span>
          </span>
        </button>

        <button className={styles.modeCard} onClick={() => void together.host('stream')}>
          <Share2 size={17} />
          <span>
            <strong>Only I have the film</strong>
            <span className={styles.modeDesc}>
              Your friends watch it straight from this PC — they need no copy and no library. Uses your
              upload bandwidth, and works best with MP4 or WebM.
            </span>
          </span>
        </button>
      </div>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Join with an invite</div>
        <input
          className={styles.input}
          value={invite}
          placeholder="100.101.102.103:7345#ABC234"
          spellCheck={false}
          onChange={(e) => setInvite(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && parsed) void join()
          }}
        />
        {invite.trim() && !parsed && (
          <div className={styles.hintWarn}>Paste the whole invite, including the code after the #.</div>
        )}
        <Button variant="subtle" disabled={!parsed || busy} onClick={() => void join()}>
          {busy ? 'Joining…' : parsed ? `Join room ${parsed.roomId}` : 'Join'}
        </Button>
      </div>

      <MeshSetup />

      <button className={styles.guideLink} onClick={onShowGuide}>
        <CircleQuestionMark size={14} />
        How watch parties work
      </button>
    </div>
  )
}

// ── Sharing details, while hosting ──────────────────────────────────────────

function HostingCard(): ReactNode {
  const hosting = useTogether((s) => s.hosting)
  const [copied, setCopied] = useState(false)
  if (!hosting) return null

  // The best address is the one a friend can actually reach — mesh first, so
  // the invite we hand over works from another continent rather than only from
  // the next room.
  const best = hosting.addresses[0] ?? null
  const invite = best ? formatInvite(best.address, hosting.port, hosting.roomId) : null
  const worldwide = best?.reach === 'mesh'

  const copy = (): void => {
    if (!invite) return
    void navigator.clipboard.writeText(invite)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className={styles.hostCard}>
      <div className={styles.hostRow}>
        <span className={styles.hostLabel}>Room code</span>
        <span className={styles.hostCode}>{hosting.roomId}</span>
      </div>

      {hosting.stream && (
        <div className={hosting.stream.guestPlayable ? styles.reachGood : styles.reachWarn}>
          <Share2 size={13} />
          <span>
            {hosting.stream.guestPlayable
              ? 'Streaming from this PC — your friends need no copy'
              : `Streaming .${hosting.stream.ext} — your friends' players may not decode it`}
          </span>
        </div>
      )}

      {invite && best ? (
        <>
          <div className={styles.hostRow}>
            <span className={styles.hostLabel}>Invite</span>
            <span className={styles.hostAddr}>{invite}</span>
          </div>
          <div className={worldwide ? styles.reachGood : styles.reachWarn}>
            {worldwide ? <Globe size={13} /> : <House size={13} />}
            <span>
              {worldwide
                ? `Reachable anywhere over ${providerName(best.provider)}`
                : 'Works on your network only'}
            </span>
          </div>
          <Button variant="subtle" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copy}>
            {copied ? 'Copied' : 'Copy invite'}
          </Button>
          <p className={styles.help}>
            Your friend pastes this one line into Join — it carries the address and the code together.
          </p>
        </>
      ) : (
        <p className={styles.help}>
          No usable network address found. Connect to a network, then reopen this panel.
        </p>
      )}

      <MeshSetup compact />

      {hosting.addresses.length > 1 && (
        <details className={styles.more}>
          <summary>Other addresses</summary>
          {hosting.addresses.slice(1).map((a) => (
            <div key={a.address} className={styles.altAddr}>
              <span>{formatInvite(a.address, hosting.port, hosting.roomId)}</span>
              <span className={styles.badgeDim}>
                {a.reach === 'mesh' ? providerName(a.provider) : a.reach === 'lan' ? 'same network' : 'public'}
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ── Ballots ─────────────────────────────────────────────────────────────────

function BallotCard({ ballot, members }: { ballot: Ballot; members: Member[] }): ReactNode {
  const meId = useTogether((s) => s.meId)
  const vote = useTogether((s) => s.vote)
  const clockOffsetMs = useTogether((s) => s.clockOffsetMs)
  const now = useNow()
  const t = tally(ballot)

  const target = members.find((m) => m.id === ballot.targetId)
  const canVote = ballot.eligible.includes(meId)
  const mine = ballot.votes[meId]
  const remaining = ballot.closesAt - (now + clockOffsetMs)

  const durationLabel = REVOKE_DURATIONS.find((d) => d.ms === ballot.durationMs)?.label ?? ''

  return (
    <div className={styles.ballot}>
      <div className={styles.ballotHead}>
        <Gavel size={15} />
        <span className={styles.ballotTitle}>
          {ballot.kind === 'resume'
            ? 'Resume playback?'
            : `Take pause & seek from ${target?.name ?? 'a watcher'}?`}
        </span>
      </div>
      {ballot.kind === 'revoke' && <div className={styles.ballotSub}>For {durationLabel}</div>}

      <div className={styles.ballotMeter}>
        <div
          className={styles.ballotFill}
          style={{ width: `${Math.min(100, (t.yes / Math.max(1, t.needed)) * 100)}%` }}
        />
      </div>
      <div className={styles.ballotStats}>
        <span>
          {t.yes} of {t.needed} needed
        </span>
        <span className={styles.badgeDim}>{countdown(remaining)} left</span>
      </div>

      {canVote ? (
        <div className={styles.ballotActions}>
          <Button
            variant={mine === 'yes' ? 'primary' : 'subtle'}
            icon={<ThumbsUp size={15} />}
            onClick={() => vote(ballot.id, 'yes')}
          >
            Yes
          </Button>
          <Button
            variant={mine === 'no' ? 'danger' : 'subtle'}
            icon={<ThumbsDown size={15} />}
            onClick={() => vote(ballot.id, 'no')}
          >
            No
          </Button>
        </div>
      ) : (
        <div className={styles.ballotSub}>
          {ballot.targetId === meId
            ? "This vote is about you, so you don't get a say."
            : 'You are not eligible to vote on this.'}
        </div>
      )}
    </div>
  )
}

// ── Member row ──────────────────────────────────────────────────────────────

function MemberRow({ member, serverNow }: { member: Member; serverNow: number }): ReactNode {
  const meId = useTogether((s) => s.meId)
  const room = useTogether((s) => s.room)
  const callRevokeVote = useTogether((s) => s.callRevokeVote)
  const ui = useUi()
  const restriction = room ? isRestricted(room.restrictions, member.id, serverNow) : null
  const isMe = member.id === meId

  const openRevokeMenu = (e: React.MouseEvent<HTMLElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    ui.openContextMenu({ x: rect.left, y: rect.bottom + 6 }, [
      { type: 'header' as const, label: `Take pause & seek from ${member.name}` },
      ...REVOKE_DURATIONS.map((d) => ({
        id: `revoke-${d.id}`,
        label: `Call a vote — ${d.label}`,
        onSelect: () => callRevokeVote(member.id, d.ms)
      }))
    ])
  }

  return (
    <div className={styles.member}>
      <div className={`${styles.dot} ${member.connected ? styles.dotOn : styles.dotOff}`} />
      <div className={styles.memberMain}>
        <div className={styles.memberName}>
          {member.name}
          {isMe && <span className={styles.you}>you</span>}
          {member.isOwner && <Crown size={12} className={styles.crown} />}
        </div>
        <div className={styles.memberMeta}>
          {!member.connected ? (
            <span className={styles.metaWarn}>
              <WifiOff size={11} /> reconnecting
            </span>
          ) : !member.ready ? (
            <span className={styles.metaWarn}>
              <Hourglass size={11} /> loading
            </span>
          ) : (
            <span>
              {Math.round(member.rttMs)} ms · {member.driftMs > 0 ? '+' : ''}
              {member.driftMs} ms
            </span>
          )}
          {member.contentMatch === 'mismatch' && (
            <span className={styles.metaWarn} title="Their file has a different runtime">
              <FileWarning size={11} /> different file
            </span>
          )}
          {restriction && (
            <span className={styles.metaWarn}>
              <ShieldOff size={11} /> {countdown(restriction.until - serverNow)}
            </span>
          )}
        </div>
      </div>
      {!isMe && !restriction && (
        <IconButton size="sm" label={`Revoke ${member.name}'s controls`} onClick={openRevokeMenu}>
          <ShieldOff size={15} />
        </IconButton>
      )}
    </div>
  )
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function TogetherPanel(): ReactNode {
  const together = useTogether()
  const room = together.room
  const [guideOpen, setGuideOpen] = useState(false)
  const audioOffsetMs = useSettings((s) => s.settings.together.audioOffsetMs)
  const localNow = useNow()
  const serverNow = localNow + together.clockOffsetMs

  const pausedBy = useMemo(
    () => room?.members.find((m) => m.id === room.timeline.pausedBy) ?? null,
    [room]
  )
  const myRestriction = room ? isRestricted(room.restrictions, together.meId, serverNow) : null
  const resumeBallotOpen = !!room?.ballots.some((b) => b.kind === 'resume')

  const canCallResume =
    !!room &&
    room.timeline.paused &&
    room.timeline.pauseReason === 'user' &&
    room.timeline.pausedBy !== together.meId &&
    !resumeBallotOpen

  return (
    <motion.aside
      className={styles.panel}
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0, transition: { duration: 0.18 } }}
      transition={springSoft}
      aria-label="Watch party"
      /* The player treats any click it receives as play/pause. Without this the
         panel is transparent to that: clicking its text, or even dragging a
         slider, toggles the video underneath. */
      data-controls
    >
      <div className={styles.head}>
        <Users size={16} />
        <span className={styles.headTitle}>
          {room ? `Watching together · ${room.members.length}` : 'Watch together'}
        </span>
        <IconButton size="sm" label="Close" onClick={() => together.setPanelOpen(false)}>
          <X size={15} />
        </IconButton>
      </div>

      <Dialog open={guideOpen} title="How watch parties work" onClose={() => setGuideOpen(false)} wide>
        <TogetherGuide />
      </Dialog>

      <div className={styles.body}>
        {!room ? (
          <StartPanel onShowGuide={() => setGuideOpen(true)} />
        ) : (
          <>
            <SyncBadge />
            <HostingCard />

            {myRestriction && (
              <div className={styles.notice}>
                <ShieldOff size={15} />
                <div>
                  <strong>Your playback controls are paused</strong>
                  <div className={styles.help}>
                    The room voted. Back in {countdown(myRestriction.until - serverNow)}.
                  </div>
                </div>
              </div>
            )}

            {room.timeline.paused && room.timeline.pauseReason === 'user' && (
              <div className={styles.notice}>
                <Pause size={15} />
                <div style={{ flex: 1 }}>
                  <strong>
                    {pausedBy
                      ? pausedBy.id === together.meId
                        ? 'You paused the room'
                        : `${pausedBy.name} paused the room`
                      : 'The room is paused'}
                  </strong>
                  {canCallResume && (
                    <div className={styles.noticeAction}>
                      <Button variant="subtle" icon={<Gavel size={15} />} onClick={together.callResumeVote}>
                        Vote to resume
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {room.timeline.pauseReason === 'buffering' && room.timeline.paused && (
              <div className={styles.notice}>
                <Hourglass size={15} />
                <div>
                  <strong>Waiting for everyone to load</strong>
                  <div className={styles.help}>Playback resumes by itself.</div>
                </div>
              </div>
            )}

            {room.ballots.map((b) => (
              <BallotCard key={b.id} ballot={b} members={room.members} />
            ))}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Watchers</div>
              <div className={styles.members}>
                {room.members.map((m) => (
                  <MemberRow key={m.id} member={m} serverNow={serverNow} />
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <Headphones size={13} /> Your audio delay
              </div>
              <p className={styles.help}>
                If the picture is in sync but your sound lands late — Bluetooth headphones usually add
                150–300&nbsp;ms — nudge this until dialogue matches everyone else.
              </p>
              <div className={styles.offsetRow}>
                <Slider
                  min={-500}
                  max={500}
                  step={10}
                  value={audioOffsetMs}
                  onChange={(v) => together.setAudioOffsetMs(v)}
                  ariaLabel="Audio delay compensation"
                />
                <span className={styles.offsetValue}>
                  {audioOffsetMs > 0 ? '+' : ''}
                  {audioOffsetMs} ms
                </span>
              </div>
            </div>

            <button className={styles.guideLink} onClick={() => setGuideOpen(true)}>
              <CircleQuestionMark size={14} />
              How watch parties work
            </button>

            <Button variant="ghost" onClick={together.leave}>
              Leave the watch party
            </Button>
          </>
        )}
      </div>
    </motion.aside>
  )
}
