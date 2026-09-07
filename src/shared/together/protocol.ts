// Together — the wire contract for synchronized watch parties.
//
// Design note (why this is not Synclify's model):
// Synclify relays *events* ("someone pressed play at t=412.3") and compensates
// once, at delivery, for the measured latency. That is correct at the instant
// of the event and slowly wrong forever after — decoders run at fractionally
// different speeds, so watchers separate by hundreds of milliseconds over a
// feature film with nothing to pull them back together.
//
// Together instead publishes an authoritative *timeline* — a media position
// pinned to a server timestamp — and every client continuously steers itself
// onto it. Events become timeline edits; staying in sync becomes a control
// loop that never stops running. See docs/TOGETHER.md.

export const TOGETHER_PROTOCOL = 3

/** Room codes are short, unambiguous, and safe to read aloud over a call. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/

export const MAX_MEMBERS = 12
export const DEFAULT_PORT = 7345

/** How far in the future a synchronized start is scheduled. Must comfortably
 *  exceed one round trip for the slowest member so nobody starts late. */
export const GATE_LEAD_MS = 900
/** A member that has not reported in this long is presumed gone. */
export const MEMBER_TIMEOUT_MS = 20_000
/** Grace period before a dropped member is removed, so a blip does not evict. */
export const REJOIN_GRACE_MS = 12_000
/** How long a ballot stays open. */
export const BALLOT_WINDOW_MS = 45_000

/** The three revocation lengths offered in the UI. */
export const REVOKE_DURATIONS = [
  { id: '5m', label: '5 minutes', ms: 5 * 60_000 },
  { id: '10m', label: '10 minutes', ms: 10 * 60_000 },
  { id: '1h', label: '1 hour', ms: 60 * 60_000 }
] as const
export type RevokeDurationId = (typeof REVOKE_DURATIONS)[number]['id']

// ── Timeline ────────────────────────────────────────────────────────────────

/**
 * The single source of truth for "where is everyone". Positions are derived,
 * never stored per member: `positionAt()` turns this plus a server clock
 * reading into the exact media time every watcher should be showing.
 */
export interface Timeline {
  /** Bumped on every edit. Clients ignore anything older than what they hold. */
  epoch: number
  /** Media position, in seconds, at `anchorTs`. */
  mediaTime: number
  /** Server clock (ms) at which the video was at `mediaTime`. */
  anchorTs: number
  rate: number
  paused: boolean
  /**
   * A scheduled joint start. While set, everyone holds at `mediaTime` until
   * this server timestamp, then begins playing in the same millisecond. This
   * is how a room resumes together instead of trickling back in one by one.
   */
  startAtTs: number | null
  /** Who paused us, and why — drives the "waiting for..." copy and resume votes. */
  pausedBy: string | null
  pauseReason: PauseReason | null
}

export type PauseReason = 'user' | 'buffering' | 'join' | 'ended'

export function initialTimeline(now: number): Timeline {
  return {
    epoch: 1,
    mediaTime: 0,
    anchorTs: now,
    rate: 1,
    paused: true,
    startAtTs: null,
    pausedBy: null,
    pauseReason: 'join'
  }
}

/** Is the room's video actually rolling at this server time? */
export function isRollingAt(tl: Timeline, serverNow: number): boolean {
  if (tl.startAtTs !== null) return serverNow >= tl.startAtTs
  return !tl.paused
}

/**
 * The media position every watcher should be at, right now. One formula for
 * playing, paused, and scheduled-start states — so there is no way for those
 * three cases to disagree about where the room is.
 */
export function positionAt(tl: Timeline, serverNow: number): number {
  if (tl.startAtTs !== null) {
    if (serverNow < tl.startAtTs) return tl.mediaTime
    return tl.mediaTime + ((serverNow - tl.startAtTs) / 1000) * tl.rate
  }
  if (tl.paused) return tl.mediaTime
  return tl.mediaTime + ((serverNow - tl.anchorTs) / 1000) * tl.rate
}

// ── Members, restrictions, ballots ──────────────────────────────────────────

export interface Member {
  id: string
  name: string
  /** Room creator. Display and tie-breaking only — the owner is not a dictator. */
  isOwner: boolean
  joinedAt: number
  connected: boolean
  /** False while this member is buffering, seeking, or otherwise not watchable. */
  ready: boolean
  /** Seconds of media buffered ahead of the playhead, when the engine knows. */
  bufferedAhead: number
  /** Round-trip time to the relay, ms — shown so people can see who is far away. */
  rttMs: number
  /** How far this member currently sits from the room timeline, ms (signed). */
  driftMs: number
  /** Set when this member's file does not match the room's. */
  contentMatch: 'match' | 'mismatch' | 'unknown'
}

/** A timed removal of one member's ability to disrupt playback. */
export interface Restriction {
  memberId: string
  /** Server timestamp at which the restriction lapses. */
  until: number
  /** Who voted it in, for the record. */
  reason: string
}

export type BallotKind = 'resume' | 'revoke'

export interface Ballot {
  id: string
  kind: BallotKind
  openedBy: string
  /** For `revoke`: whose privileges are on the line. */
  targetId: string | null
  /** For `revoke`: how long the revocation would last. */
  durationMs: number | null
  openedAt: number
  closesAt: number
  /** Members entitled to vote — never includes the ballot's subject. */
  eligible: string[]
  votes: Record<string, 'yes' | 'no'>
}

/** What the room looks like to every client. Sent whole; never patched. */
export interface RoomSnapshot {
  roomId: string
  protocol: number
  serverTs: number
  timeline: Timeline
  members: Member[]
  restrictions: Restriction[]
  ballots: Ballot[]
  /** Title + duration of what the room is watching, for the mismatch check. */
  content: ContentRef | null
}

/**
 * Identifies "the same show" across watchers who each hold their own copy.
 * Duration is the load-bearing part: two rips of one film agree on runtime to
 * within a second or so, while a different cut will not.
 */
export interface ContentRef {
  key: string
  title: string
  durationSec: number
}

// ── Client to server ────────────────────────────────────────────────────────

export type ClientMessage =
  | { t: 'hello'; protocol: number; roomId: string; memberId: string; name: string; content: ContentRef | null }
  | { t: 'ping'; id: number; clientTs: number }
  | { t: 'intent'; kind: 'play' | 'pause' | 'seek' | 'rate'; mediaTime: number; rate?: number }
  | { t: 'report'; ready: boolean; bufferedAhead: number; mediaTime: number; driftMs: number; rttMs: number }
  | { t: 'content'; content: ContentRef }
  | { t: 'callVote'; kind: BallotKind; targetId?: string; durationMs?: number }
  | { t: 'vote'; ballotId: string; choice: 'yes' | 'no' }
  | { t: 'bye' }

// ── Server to client ────────────────────────────────────────────────────────

export type ServerMessage =
  | { t: 'welcome'; memberId: string; room: RoomSnapshot }
  | { t: 'pong'; id: number; clientTs: number; serverTs: number }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'denied'; action: string; reason: DenyReason; until?: number; message: string }
  | { t: 'notice'; level: 'info' | 'ok' | 'warn'; title: string; desc?: string }
  | { t: 'error'; code: ErrorCode; message: string }

export type DenyReason = 'restricted' | 'no-such-member' | 'ballot-open' | 'would-lock-room'
export type ErrorCode = 'bad-protocol' | 'bad-room' | 'room-full' | 'malformed'

// ── Helpers shared by both ends ─────────────────────────────────────────────

export function makeRoomCode(rand: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)]
  }
  return out
}

/**
 * Normalize a title down to what every copy of a film agrees on. Deliberately
 * ignores file name decoration, size, and codec: friends rarely hold
 * byte-identical rips, and refusing to sync over that would make the feature
 * useless.
 */
export function contentKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/\b(1080p|720p|2160p|4k|uhd|hdr|x264|x265|h ?26[45]|hevc|web-?dl|webrip|bluray|bdrip|dvdrip|remux|proper|repack)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Runtimes within this many seconds are treated as the same cut. */
export const DURATION_TOLERANCE_SEC = 5

/**
 * Do two watchers have the same thing on screen? Compared with a tolerance
 * rather than by bucketing a key, because any bucket has edges — two rips
 * three seconds apart would land either side of one and be declared different
 * films purely by where the boundary happened to fall.
 */
export function contentMatches(a: ContentRef, b: ContentRef): boolean {
  if (a.key !== b.key) return false
  return Math.abs(a.durationSec - b.durationSec) <= DURATION_TOLERANCE_SEC
}

export function isRestricted(
  restrictions: Restriction[],
  memberId: string,
  now: number
): Restriction | null {
  return restrictions.find((r) => r.memberId === memberId && r.until > now) ?? null
}
