import { create } from 'zustand'
import { platform, isDesktop } from '@/core/platform'
import type { RoomSnapshot, TogetherStatus } from '@shared/together/api'
import { contentRefFor } from '@shared/together/api'
import {
  isRestricted,
  isRollingAt,
  positionAt,
  ROOM_CODE_RE,
  streamUrlFrom,
  type Ballot,
  type Member,
  type Restriction
} from '@shared/together/protocol'
import { formatInvite, normalizeHost, parseInvite, type Invite, type MeshStatus, type NetAddress } from '@shared/together/mesh'
import { decideCorrection, describeDrift, initialDriftState, type DriftState } from '@shared/together/drift'
import { decideReadiness } from '@shared/together/readiness'
import {
  rawPause,
  rawPlay,
  rawPosition,
  rawSeek,
  rawSetEffectiveRate,
  setPlaybackIntercept,
  usePlayer
} from './player'
import { makeStreamItem } from '@/core/streams'
import { useSettings } from './settings'
import { useUi } from './ui'

/** How often the controller compares itself to the room. */
const TICK_MS = 250
/** How often we tell the room where we are. */
const REPORT_MS = 1000

export type SyncQuality = 'locked' | 'close' | 'drifting' | 'off' | 'unknown'

/**
 * 'library' — everyone plays their own copy of the film.
 * 'stream'  — only the host has it; the rest watch it from them.
 */
export type RoomMode = 'library' | 'stream'

interface TogetherStore {
  status: TogetherStatus
  room: RoomSnapshot | null
  /** Our own member id, echoed back so the UI can find "you" in the list. */
  meId: string
  /** localClock + this = relay clock. */
  clockOffsetMs: number
  rttMs: number
  clockSettled: boolean
  /** Signed ms this client sits from the room timeline. */
  driftMs: number
  quality: SyncQuality
  /** The relay address this client actually reached, for deriving media URLs. */
  relayUrl: string | null
  /** Set while hosting, so the UI can show what to share. */
  hosting: {
    roomId: string
    port: number
    addresses: NetAddress[]
    /** Present in a streaming room; guestPlayable false means wrong codec. */
    stream: { guestPlayable: boolean; ext: string } | null
  } | null
  /** What mesh VPNs are installed and whether any is currently reachable. */
  mesh: MeshStatus | null
  meshInstalling: boolean
  meshLog: string[]
  panelOpen: boolean
  lastDenial: { message: string; until?: number } | null

  init(): void
  /** Host a room. 'stream' serves your file so only you need a copy of it. */
  host(mode?: RoomMode): Promise<void>
  join(url: string, roomId: string): Promise<void>
  /** Join from a single pasted invite token. */
  joinInvite(invite: string): Promise<boolean>
  /** An invite sitting in the clipboard, so joining is one click. */
  clipboardInvite: Invite | null
  checkClipboard(): Promise<void>
  refreshMesh(): Promise<void>
  installMesh(provider: 'zerotier' | 'tailscale'): Promise<void>
  joinZeroTier(networkId: string): Promise<boolean>
  openMeshSetup(provider: 'zerotier' | 'tailscale'): void
  leave(): void
  setPanelOpen(open: boolean): void
  setDisplayName(name: string): void
  setAudioOffsetMs(ms: number): void
  callResumeVote(): void
  callRevokeVote(targetId: string, durationMs: number): void
  vote(ballotId: string, choice: 'yes' | 'no'): void

  // Derived helpers the UI leans on
  me(): Member | null
  isActive(): boolean
  myRestriction(): Restriction | null
  openBallots(): Ballot[]
}

let ticker: number | null = null
let reporter: number | null = null
let driftState: DriftState = initialDriftState()
let lastAppliedEpoch = -1
let lastReportedContentKey = ''
/** Previous readiness answer — the hysteresis that stops threshold flapping. */
let lastReported = false
let unsubEvent: (() => void) | null = null

/** A stable-ish identity for this install, created once and persisted. */
function ensureIdentity(): { memberId: string; displayName: string } {
  const t = useSettings.getState().settings.together
  let { memberId, displayName } = t
  const patch: Record<string, string> = {}
  if (!memberId) {
    memberId = `m-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
    patch.memberId = memberId
  }
  if (!displayName) {
    displayName = 'Watcher'
    patch.displayName = displayName
  }
  if (Object.keys(patch).length) void useSettings.getState().patch({ together: patch })
  return { memberId, displayName }
}

export const useTogether = create<TogetherStore>((set, get) => ({
  status: 'idle',
  room: null,
  meId: '',
  clockOffsetMs: 0,
  rttMs: 0,
  clockSettled: false,
  driftMs: 0,
  quality: 'unknown',
  relayUrl: null,
  hosting: null,
  clipboardInvite: null,
  mesh: null,
  meshInstalling: false,
  meshLog: [],
  panelOpen: false,
  lastDenial: null,

  init() {
    if (unsubEvent) return
    unsubEvent = platform.together.onEvent((e) => {
      switch (e.type) {
        case 'status':
          set({ status: e.status })
          if (e.status === 'idle') teardown(set)
          if (e.status === 'error') {
            useUi.getState().toast(
              { kind: 'warn', title: 'Watch party disconnected', desc: e.message },
              5000
            )
            teardown(set)
          }
          break
        case 'clock':
          set({ clockOffsetMs: e.clockOffsetMs, rttMs: e.rttMs, clockSettled: e.settled })
          break
        case 'room':
          set({
            room: e.room,
            clockOffsetMs: e.clockOffsetMs,
            rttMs: e.rttMs,
            clockSettled: e.settled
          })
          ensureStreamSource(e.room)
          applyTimeline(e.room)
          break
        case 'denied':
          set({ lastDenial: { message: e.message, until: e.until } })
          useUi.getState().toast({ kind: 'warn', title: 'Not right now', desc: e.message }, 5000)
          break
        case 'notice':
          useUi.getState().toast({ kind: e.level, title: e.title, desc: e.desc }, 3600)
          break
        case 'error':
          useUi.getState().toast({ kind: 'warn', title: 'Watch party', desc: e.message }, 5000)
          break
      }
    })
  },

  async host(mode = 'library') {
    if (!isDesktop) {
      useUi.getState().toast({ kind: 'warn', title: 'Watch parties need the desktop app' })
      return
    }
    const item = usePlayer.getState().item
    if (mode === 'stream' && !item) {
      useUi.getState().toast({ kind: 'warn', title: 'Open the video you want to share first' })
      return
    }
    const { memberId, displayName } = ensureIdentity()
    const { hostPort } = useSettings.getState().settings.together
    try {
      const info = await platform.together.host({
        name: displayName,
        memberId,
        content: currentContent(),
        port: hostPort,
        ...(mode === 'stream' && item
          ? {
              streamPath: item.path,
              streamTitle: item.title,
              streamDurationSec: usePlayer.getState().duration || item.durationSec || 0
            }
          : {})
      })

      // A container Chromium cannot decode plays fine for the host through mpv
      // and shows nothing at all for everyone else. Say so now, not later.
      if (info.stream && !info.stream.guestPlayable) {
        useUi.getState().toast(
          {
            kind: 'warn',
            title: `Your friends may not be able to play .${info.stream.ext}`,
            desc: 'Guests decode in the browser engine. MP4, M4V, WebM and MOV are the safe choices.'
          },
          9000
        )
      }
      set({ meId: memberId, hosting: info, panelOpen: true, relayUrl: null })
      void get().refreshMesh()
      startController()

      const best = info.addresses[0]
      if (best) {
        const invite = formatInvite(best.address, info.port, info.roomId)
        try {
          await navigator.clipboard.writeText(invite)
          useUi.getState().toast(
            {
              kind: 'ok',
              title: 'Invite copied — send it to your friend',
              desc: best.reach === 'mesh' ? invite : `${invite} · works on your network only`
            },
            7000
          )
        } catch {
          // Clipboard refused; the panel still shows the invite and a button.
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUi.getState().toast(
        {
          kind: 'warn',
          title: 'Could not start the watch party',
          desc: message.includes('EADDRINUSE')
            ? `Port ${hostPort} is already in use. Pick another in Settings.`
            : message
        },
        6000
      )
    }
  },

  async join(url, roomId) {
    if (!isDesktop) {
      useUi.getState().toast({ kind: 'warn', title: 'Watch parties need the desktop app' })
      return
    }
    const code = roomId.trim().toUpperCase()
    if (!ROOM_CODE_RE.test(code)) {
      useUi.getState().toast({ kind: 'warn', title: 'That room code does not look right' })
      return
    }
    const { memberId, displayName } = ensureIdentity()
    const normalized = normalizeHost(url)
    if (!normalized) {
      useUi.getState().toast({ kind: 'warn', title: 'That address does not look right' })
      return
    }
    await platform.together.join({
      url: normalized,
      roomId: code,
      name: displayName,
      memberId,
      content: currentContent()
    })
    void useSettings.getState().patch({ together: { lastRelayUrl: normalized } })
    set({ meId: memberId, hosting: null, panelOpen: true, relayUrl: normalized })
    startController()
  },

  async joinInvite(invite) {
    const parsed = parseInvite(invite)
    if (!parsed) return false
    await get().join(parsed.url, parsed.roomId)
    return true
  },

  async checkClipboard() {
    // No desktop gate: the browser mock answers safely, so this stays
    // exercisable in dev:web instead of being dead code outside Electron.
    if (get().room) return
    try {
      const text = await platform.shell.readClipboardText()
      set({ clipboardInvite: parseInvite(text) })
    } catch {
      set({ clipboardInvite: null })
    }
  },

  async refreshMesh() {
    if (!isDesktop) return
    try {
      set({ mesh: await platform.together.mesh.status() })
    } catch {
      set({ mesh: null })
    }
  },

  async installMesh(provider) {
    if (get().meshInstalling) return
    const hasWinget = await platform.together.mesh.hasWinget()
    if (!hasWinget) {
      // No package manager to drive, so hand them the official download rather
      // than failing silently.
      useUi.getState().toast(
        {
          kind: 'warn',
          title: 'Automatic install needs Windows Package Manager',
          desc: 'Opening the download page instead.'
        },
        4500
      )
      platform.together.mesh.openSetup(provider)
      return
    }

    set({ meshInstalling: true, meshLog: ['Starting Windows Package Manager…'] })
    const unsub = platform.together.mesh.onInstallProgress((line) => {
      set((s) => ({ meshLog: [...s.meshLog, line].slice(-5) }))
    })
    try {
      const res = await platform.together.mesh.install(provider)
      unsub()
      set({ meshInstalling: false, meshLog: [] })
      await get().refreshMesh()
      if (res.ok) {
        useUi.getState().toast(
          {
            kind: 'ok',
            title: `${provider === 'zerotier' ? 'ZeroTier' : 'Tailscale'} installed`,
            desc: 'Now join a network so friends can reach you.'
          },
          5000
        )
      } else {
        useUi.getState().toast(
          { kind: 'warn', title: "Couldn't install automatically", desc: 'Opening the download page.' },
          5000
        )
        platform.together.mesh.openSetup(provider)
      }
    } catch {
      unsub()
      set({ meshInstalling: false, meshLog: [] })
      useUi.getState().toast({ kind: 'warn', title: 'Install failed' }, 4000)
    }
  },

  async joinZeroTier(networkId) {
    const res = await platform.together.mesh.joinZeroTier(networkId)
    if (res.ok) {
      useUi.getState().toast(
        {
          kind: 'ok',
          title: 'Joined the ZeroTier network',
          desc: 'Authorize this device at my.zerotier.com, then your address appears here.'
        },
        6000
      )
      // The adapter takes a moment to come up and get an address.
      window.setTimeout(() => void get().refreshMesh(), 2500)
      window.setTimeout(() => void get().refreshMesh(), 6000)
    } else {
      const desc =
        res.reason === 'not-installed'
          ? 'ZeroTier is not installed yet.'
          : res.reason === 'bad-network'
            ? 'A network ID is 16 characters, like 8056c2e21c000001.'
            : 'The join was cancelled or failed.'
      useUi.getState().toast({ kind: 'warn', title: "Couldn't join", desc }, 5000)
    }
    return res.ok
  },

  openMeshSetup(provider) {
    platform.together.mesh.openSetup(provider)
  },

  leave() {
    platform.together.leave()
    teardown(set)
  },

  setPanelOpen(open) {
    set({ panelOpen: open })
  },

  setDisplayName(name) {
    void useSettings.getState().patch({ together: { displayName: name.slice(0, 24) } })
  },

  setAudioOffsetMs(ms) {
    // Clamped to the range real output latency lives in. Beyond a second this
    // stops being a latency correction and starts being a desync.
    const clamped = Math.max(-1000, Math.min(1000, Math.round(ms)))
    void useSettings.getState().patch({ together: { audioOffsetMs: clamped } })
  },

  callResumeVote() {
    platform.together.callVote('resume')
  },
  callRevokeVote(targetId, durationMs) {
    platform.together.callVote('revoke', targetId, durationMs)
  },
  vote(ballotId, choice) {
    platform.together.vote(ballotId, choice)
  },

  me() {
    const { room, meId } = get()
    return room?.members.find((m) => m.id === meId) ?? null
  },
  isActive() {
    const s = get()
    return s.room !== null && (s.status === 'connected' || s.status === 'reconnecting')
  },
  myRestriction() {
    const { room, meId } = get()
    if (!room) return null
    return isRestricted(room.restrictions, meId, serverNow())
  },
  openBallots() {
    return get().room?.ballots ?? []
  }
}))

// ── Clock and content helpers ───────────────────────────────────────────────

/** The relay's clock, as best this machine can tell. */
function serverNow(): number {
  return Date.now() + useTogether.getState().clockOffsetMs
}

function currentContent(): ReturnType<typeof contentRefFor> | null {
  const item = usePlayer.getState().item
  if (!item) return null
  return contentRefFor(item.title, usePlayer.getState().duration || item.durationSec || 0)
}

/**
 * Where this client should be right now, in its own media time.
 *
 * Two per-viewer corrections ride on top of the room position. `audioOffsetMs`
 * compensates for this person's own output latency — Bluetooth headphones can
 * add 200ms, and without this their picture is in sync while their *sound* is
 * late. Nudging their video that much ahead lands the audio on the beat with
 * everyone else's.
 */
function targetPosition(room: RoomSnapshot, now: number): number {
  const { audioOffsetMs } = useSettings.getState().settings.together
  return positionAt(room.timeline, now) + audioOffsetMs / 1000
}

/**
 * In a streaming room the host serves the film and everyone else plays it from
 * them, so a guest does not need the file — or even a library. Opening it here
 * means a guest's whole job is pasting the invite.
 */
function ensureStreamSource(room: RoomSnapshot): void {
  const s = useTogether.getState()
  // The host already has the real file open; only guests need the stream.
  if (!room.stream || s.hosting || !s.relayUrl) return

  const url = streamUrlFrom(s.relayUrl, room.stream.token)
  const player = usePlayer.getState()
  if (player.item?.path === url) return

  player.openItem(makeStreamItem(url, room.stream.title), { queue: [] })
}

// ── The controller ──────────────────────────────────────────────────────────

/**
 * Apply a freshly arrived timeline. This handles the discrete jumps — pauses,
 * seeks, scheduled starts — while the tick below handles the slow drift.
 */
function applyTimeline(room: RoomSnapshot): void {
  const player = usePlayer.getState()
  if (!player.item) return

  const tl = room.timeline
  const now = serverNow()
  const rolling = isRollingAt(tl, now)

  // A new epoch means somebody edited the timeline: land on the new position
  // rather than drifting towards it, so a seek feels like a seek.
  if (tl.epoch !== lastAppliedEpoch) {
    lastAppliedEpoch = tl.epoch
    driftState = initialDriftState()
    const target = targetPosition(room, now)
    if (Math.abs(rawPosition() - target) > 0.25) rawSeek(target)
  }

  if (rolling) {
    if (player.status !== 'playing') rawPlay()
  } else if (player.status === 'playing') {
    rawPause()
  }
}

function tick(): void {
  const s = useTogether.getState()
  const room = s.room
  const player = usePlayer.getState()
  if (!room || !player.item) return

  const now = serverNow()
  const rolling = isRollingAt(room.timeline, now)

  // A scheduled start is a promise about a future instant. Hold the frame and
  // let the tick that crosses it start playback — this is what puts everyone
  // on the same frame instead of in ping-time order.
  if (room.timeline.startAtTs !== null && now < room.timeline.startAtTs) {
    if (player.status === 'playing') rawPause()
    return
  }
  if (rolling && player.status !== 'playing' && player.status !== 'loading') rawPlay()
  if (!rolling && player.status === 'playing') rawPause()

  const local = rawPosition()
  const target = targetPosition(room, now)
  const drift = local - target

  // Do not steer on a clock we do not trust yet. Correcting towards a target
  // that is itself wrong is worse than briefly doing nothing.
  if (!s.clockSettled) {
    useTogether.setState({ driftMs: Math.round(drift * 1000), quality: 'unknown' })
    return
  }

  const { correction, state } = decideCorrection(
    { localTime: local, targetTime: target, rolling, now: Date.now() },
    driftState
  )
  driftState = state

  if (correction.action === 'seek' && correction.seekTo !== null) {
    rawSeek(correction.seekTo)
  } else {
    // The room's rate is the baseline; the nudge rides on top of it.
    rawSetEffectiveRate(room.timeline.rate * correction.rateMultiplier)
  }

  useTogether.setState({
    driftMs: Math.round(drift * 1000),
    quality: describeDrift(drift * 1000)
  })
}

/** Buffered seconds ahead of the playhead, for the room's ready-gate. */
function bufferedAhead(): number {
  const { buffered, time } = usePlayer.getState()
  const range = buffered.find(([start, end]) => time >= start - 0.1 && time <= end)
  return range ? Math.max(0, range[1] - time) : 0
}

function report(): void {
  const player = usePlayer.getState()
  const s = useTogether.getState()
  if (!s.room) return

  const ahead = bufferedAhead()

  // Readiness is a statement about buffered data, never about whether we are
  // paused — see shared/together/readiness.ts. Tying it to pause state created
  // a loop the room could not escape: paused => "ready" => resume => stall =>
  // paused, cycling several times a second.
  const ready = decideReadiness({
    hasItem: !!player.item,
    status: player.status,
    // mpv renders out of process and never fills `buffered`, so it reports no
    // opinion rather than an empty one.
    bufferedAhead: player.mpvMode === 'playing' ? null : ahead,
    wasReady: lastReported
  })
  lastReported = ready

  platform.together.report({
    ready,
    bufferedAhead: Math.round(ahead * 10) / 10,
    mediaTime: rawPosition(),
    driftMs: s.driftMs
  })

  // Tell the room if we have changed what we are watching.
  const content = currentContent()
  if (content && content.key !== lastReportedContentKey) {
    lastReportedContentKey = content.key
    platform.together.setContent(content)
  }
}

function startController(): void {
  stopController()
  driftState = initialDriftState()
  lastAppliedEpoch = -1
  lastReportedContentKey = ''
  lastReported = false

  // Every user action becomes a request to the room. Nothing is applied
  // locally here — the timeline that comes back is what moves this player,
  // which is precisely why all watchers stay on the same frame.
  setPlaybackIntercept({
    play() {
      platform.together.intent('play', rawPosition())
      return true
    },
    pause() {
      platform.together.intent('pause', rawPosition())
      return true
    },
    seek(sec) {
      platform.together.intent('seek', Math.max(0, sec))
      return true
    },
    rate(r) {
      platform.together.intent('rate', rawPosition(), r)
      return true
    },
    autoplay: () => false
  })

  ticker = window.setInterval(tick, TICK_MS)
  reporter = window.setInterval(report, REPORT_MS)
}

function stopController(): void {
  if (ticker) window.clearInterval(ticker)
  if (reporter) window.clearInterval(reporter)
  ticker = null
  reporter = null
  setPlaybackIntercept(null)
  // Hand the user's chosen speed back — leaving a 1.03x nudge applied would
  // desync them from nothing at all, forever.
  const { rate } = usePlayer.getState()
  rawSetEffectiveRate(rate)
}

function teardown(set: (partial: Partial<TogetherStore>) => void): void {
  stopController()
  set({
    room: null,
    hosting: null,
    driftMs: 0,
    quality: 'unknown',
    clockSettled: false,
    lastDenial: null
  })
}
