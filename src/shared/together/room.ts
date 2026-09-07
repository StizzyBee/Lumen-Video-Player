// The authoritative room state machine.
//
// Kept free of sockets and timers on purpose: every rule about who may pause,
// how a vote is counted, and when the room resumes together is a pure function
// of (state, event, now). The relay is a thin shell that feeds it messages and
// broadcasts snapshots, and the whole thing is testable without a network.

import {
  AUTO_PAUSE_COOLDOWN_MS,
  BALLOT_WINDOW_MS,
  TOGETHER_PROTOCOL,
  GATE_LEAD_MS,
  MAX_MEMBERS,
  initialTimeline,
  contentMatches,
  isRestricted,
  positionAt,
  type Ballot,
  type BallotKind,
  type ContentRef,
  type DenyReason,
  type Member,
  type Restriction,
  type RoomSnapshot,
  type Timeline
} from './protocol'

export interface RoomState {
  roomId: string
  timeline: Timeline
  members: Map<string, Member>
  restrictions: Restriction[]
  ballots: Ballot[]
  content: ContentRef | null
  /** Set when playback was suspended by buffering, so it can resume itself. */
  autoResume: boolean
  /** When the room last resumed itself, for the anti-strobe cooldown. */
  lastAutoResumeAt: number
  ballotSeq: number
}

export function createRoom(roomId: string, now: number): RoomState {
  return {
    roomId,
    timeline: initialTimeline(now),
    members: new Map(),
    restrictions: [],
    ballots: [],
    content: null,
    autoResume: false,
    lastAutoResumeAt: 0,
    ballotSeq: 1
  }
}

export interface Effect {
  /** Send a denial back to the member that asked. */
  deny?: { memberId: string; action: string; reason: DenyReason; until?: number; message: string }
  /** Broadcast an advisory to everyone. */
  notice?: { level: 'info' | 'ok' | 'warn'; title: string; desc?: string }
  /** True when the snapshot changed and should be broadcast. */
  changed: boolean
}

const none: Effect = { changed: false }
const changed = (extra: Omit<Effect, 'changed'> = {}): Effect => ({ ...extra, changed: true })

// ── Membership ──────────────────────────────────────────────────────────────

export function join(
  room: RoomState,
  memberId: string,
  name: string,
  content: ContentRef | null,
  now: number
): { ok: true; effect: Effect } | { ok: false; reason: 'room-full' } {
  const existing = room.members.get(memberId)
  if (!existing && room.members.size >= MAX_MEMBERS) return { ok: false, reason: 'room-full' }

  if (existing) {
    // A reconnect, not a new person. Keep their standing — including any
    // restriction, so dropping the connection is not a way to shed one.
    existing.connected = true
    existing.name = name
    existing.ready = false
    if (content) existing.contentMatch = matchContent(room, content)
    return { ok: true, effect: changed() }
  }

  // The first person to arrive with a file decides what the room is watching.
  // Adopt it before judging the match, or the founder is forever 'unknown'.
  const isFirstContent = !room.content && !!content
  if (isFirstContent) room.content = content

  const member: Member = {
    id: memberId,
    name,
    isOwner: room.members.size === 0,
    joinedAt: now,
    connected: true,
    // Never ready on arrival: the joiner has not loaded a frame yet, and the
    // ready-gate below is what stops the room resuming without them.
    ready: false,
    bufferedAhead: 0,
    rttMs: 0,
    driftMs: 0,
    contentMatch: content ? matchContent(room, content) : 'unknown'
  }
  room.members.set(memberId, member)

  // Somebody new needs time to load. Hold the room rather than leaving them
  // to catch up alone — that is the whole point of watching together.
  if (isRolling(room, now)) {
    suspend(room, 'join', memberId, now)
    room.autoResume = true
  }
  return { ok: true, effect: changed({ notice: { level: 'info', title: `${name} joined` } }) }
}

export function disconnect(room: RoomState, memberId: string, now: number): Effect {
  const member = room.members.get(memberId)
  if (!member) return none
  member.connected = false
  member.ready = false
  // Do not pause for someone who left mid-scene — only for members who are
  // still here and still loading. reevaluateGate sorts that out.
  return changed({ ...maybeResume(room, now) })
}

export function remove(room: RoomState, memberId: string, now: number): Effect {
  if (!room.members.delete(memberId)) return none
  // Their vote is no longer eligible, so ballots may now be decided.
  for (const b of room.ballots) {
    b.eligible = b.eligible.filter((id) => id !== memberId)
    delete b.votes[memberId]
  }
  const effect = resolveBallots(room, now)
  return changed({ ...effect })
}

function matchContent(room: RoomState, content: ContentRef): Member['contentMatch'] {
  if (!room.content) return 'unknown'
  return contentMatches(room.content, content) ? 'match' : 'mismatch'
}

export function setContent(room: RoomState, memberId: string, content: ContentRef): Effect {
  const member = room.members.get(memberId)
  if (!member) return none
  if (!room.content) room.content = content
  member.contentMatch = matchContent(room, content)
  return changed()
}

// ── Reports (the ready-gate) ────────────────────────────────────────────────

export function report(
  room: RoomState,
  memberId: string,
  data: { ready: boolean; bufferedAhead: number; driftMs: number; rttMs: number },
  now: number
): Effect {
  const member = room.members.get(memberId)
  if (!member) return none

  const wasReady = member.ready
  member.ready = data.ready
  member.bufferedAhead = data.bufferedAhead
  member.driftMs = data.driftMs
  member.rttMs = data.rttMs

  if (wasReady === data.ready) return changed()

  // A stall counts whether we are already rolling or merely about to. Missing
  // the second case would let a scheduled start fire without somebody who
  // dropped out during the lead-in — the room leaves them behind at the exact
  // moment the gate exists to prevent that.
  const stalling = !data.ready && (isRolling(room, now) || room.timeline.startAtTs !== null)
  if (stalling && now - room.lastAutoResumeAt < AUTO_PAUSE_COOLDOWN_MS) {
    // Too soon after the last automatic resume to stop again. Believing this
    // member every time would let one flapping connection strobe the room.
    return changed()
  }
  if (stalling) {
    // Somebody stalled. Everyone waits — this is the behaviour that makes a
    // room feel like a sofa rather than two separate screens.
    suspend(room, 'buffering', memberId, now)
    room.autoResume = true
    return changed({
      notice: { level: 'info', title: `Waiting for ${member.name}`, desc: 'Their video is still loading.' }
    })
  }
  return changed({ ...maybeResume(room, now) })
}

/** Everyone still present and connected has a frame ready to show. */
function allReady(room: RoomState): boolean {
  const present = [...room.members.values()].filter((m) => m.connected)
  return present.length > 0 && present.every((m) => m.ready)
}

/**
 * Resume, but only if the pause was ours to lift. A pause a person chose is
 * never undone automatically — that needs a vote, or for them to press play.
 */
function maybeResume(room: RoomState, now: number): Omit<Effect, 'changed'> {
  if (!room.autoResume || !room.timeline.paused) return {}
  if (!allReady(room)) return {}
  room.autoResume = false
  room.lastAutoResumeAt = now
  scheduleStart(room, room.timeline.mediaTime, now)
  return { notice: { level: 'ok', title: 'Everyone is ready', desc: 'Starting together.' } }
}

// ── Timeline edits ──────────────────────────────────────────────────────────

function isRolling(room: RoomState, now: number): boolean {
  const tl = room.timeline
  if (tl.startAtTs !== null) return now >= tl.startAtTs
  return !tl.paused
}

/** Freeze the room at wherever it currently is. */
function suspend(room: RoomState, reason: Timeline['pauseReason'], by: string | null, now: number): void {
  const at = positionAt(room.timeline, now)
  room.timeline = {
    ...room.timeline,
    epoch: room.timeline.epoch + 1,
    mediaTime: at,
    anchorTs: now,
    paused: true,
    startAtTs: null,
    pausedBy: by,
    pauseReason: reason
  }
}

/**
 * Arrange for everyone to start at the same instant. The lead time is what
 * turns "we all pressed play" into "we all started on the same frame": each
 * client seeks, holds, and releases on a shared future timestamp rather than
 * whenever its own message happened to arrive.
 */
function scheduleStart(room: RoomState, mediaTime: number, now: number): void {
  room.timeline = {
    ...room.timeline,
    epoch: room.timeline.epoch + 1,
    mediaTime,
    anchorTs: now,
    paused: true,
    startAtTs: now + GATE_LEAD_MS,
    pausedBy: null,
    pauseReason: null
  }
}

export function intent(
  room: RoomState,
  memberId: string,
  kind: 'play' | 'pause' | 'seek' | 'rate',
  mediaTime: number,
  rate: number | undefined,
  now: number
): Effect {
  const member = room.members.get(memberId)
  if (!member) return none

  // Restrictions gate everything that moves the room. Pause is the headline —
  // it is what the vote is about — but a member who could still seek could
  // wreck a film just as thoroughly, so the whole set travels together.
  const restriction = isRestricted(room.restrictions, memberId, now)
  if (restriction) {
    const mins = Math.ceil((restriction.until - now) / 60_000)
    return {
      changed: false,
      deny: {
        memberId,
        action: kind,
        reason: 'restricted',
        until: restriction.until,
        message: `Playback control is paused for you for about ${mins} more minute${mins === 1 ? '' : 's'}.`
      }
    }
  }

  switch (kind) {
    case 'pause': {
      // Anyone may stop the room, instantly and without asking. Getting up is
      // not a decision that should need a committee; getting *going* again is.
      if (room.timeline.paused && room.timeline.startAtTs === null) return none
      suspend(room, 'user', memberId, now)
      room.autoResume = false
      return changed({ notice: { level: 'info', title: `${member.name} paused` } })
    }
    case 'play': {
      if (isRolling(room, now)) return none
      // Play always goes through the gate, even for a plain unpause, so the
      // room leaves together rather than in ping-time order.
      room.autoResume = false
      scheduleStart(room, room.timeline.mediaTime, now)
      closeBallotsOfKind(room, 'resume')
      return changed({ notice: { level: 'ok', title: `${member.name} resumed` } })
    }
    case 'seek': {
      const wasRolling = isRolling(room, now)
      // Land everyone on the new position before anyone plays from it.
      room.timeline = {
        ...room.timeline,
        epoch: room.timeline.epoch + 1,
        mediaTime: Math.max(0, mediaTime),
        anchorTs: now,
        paused: true,
        startAtTs: wasRolling ? now + GATE_LEAD_MS : null,
        pausedBy: wasRolling ? null : room.timeline.pausedBy,
        pauseReason: wasRolling ? null : room.timeline.pauseReason
      }
      // Nobody has decoded the new position yet; the gate re-forms on reports.
      for (const m of room.members.values()) m.ready = false
      if (wasRolling) room.autoResume = true
      return changed()
    }
    case 'rate': {
      const next = Math.max(0.25, Math.min(4, rate ?? 1))
      const at = positionAt(room.timeline, now)
      room.timeline = {
        ...room.timeline,
        epoch: room.timeline.epoch + 1,
        mediaTime: at,
        anchorTs: now,
        rate: next
      }
      return changed({ notice: { level: 'info', title: `${member.name} set speed to ${next}x` } })
    }
  }
}

// ── Votes ───────────────────────────────────────────────────────────────────

/**
 * Who gets a say. The subject of a ballot never votes on it: the person who
 * paused cannot veto the room's wish to carry on, and nobody defends their own
 * privileges by outvoting a room of two.
 */
function eligibleFor(room: RoomState, subjectId: string | null): string[] {
  return [...room.members.values()]
    .filter((m) => m.connected && m.id !== subjectId)
    .map((m) => m.id)
}

export function callVote(
  room: RoomState,
  memberId: string,
  kind: BallotKind,
  targetId: string | undefined,
  durationMs: number | undefined,
  now: number
): Effect {
  const caller = room.members.get(memberId)
  if (!caller) return none

  const subject = kind === 'resume' ? room.timeline.pausedBy : (targetId ?? null)
  if (kind === 'revoke') {
    if (!subject || !room.members.has(subject)) {
      return {
        changed: false,
        deny: { memberId, action: 'callVote', reason: 'no-such-member', message: 'That watcher is no longer here.' }
      }
    }
    // A room where nobody can pause is a room nobody can stop. Refuse the last
    // revocation rather than leaving everyone locked out of their own film.
    const unrestricted = [...room.members.values()].filter(
      (m) => m.connected && !isRestricted(room.restrictions, m.id, now)
    )
    if (unrestricted.length <= 1 && unrestricted[0]?.id === subject) {
      return {
        changed: false,
        deny: {
          memberId,
          action: 'callVote',
          reason: 'would-lock-room',
          message: 'Someone has to be able to pause — this would leave nobody.'
        }
      }
    }
  }

  if (kind === 'resume' && !room.timeline.paused) return none

  // One ballot of a kind at a time, per subject. Otherwise a room can be
  // buried under duplicate votes faster than anyone can read them.
  const duplicate = room.ballots.find((b) => b.kind === kind && b.targetId === subject)
  if (duplicate) {
    return {
      changed: false,
      deny: { memberId, action: 'callVote', reason: 'ballot-open', message: 'That vote is already running.' }
    }
  }

  const ballot: Ballot = {
    id: `b${room.ballotSeq++}`,
    kind,
    openedBy: memberId,
    targetId: subject,
    durationMs: kind === 'revoke' ? (durationMs ?? 5 * 60_000) : null,
    openedAt: now,
    closesAt: now + BALLOT_WINDOW_MS,
    eligible: eligibleFor(room, subject),
    // The caller's support is implied — they opened it.
    votes: { [memberId]: 'yes' }
  }
  room.ballots.push(ballot)
  return { ...resolveBallots(room, now), changed: true }
}

export function castVote(
  room: RoomState,
  memberId: string,
  ballotId: string,
  choice: 'yes' | 'no',
  now: number
): Effect {
  const ballot = room.ballots.find((b) => b.id === ballotId)
  if (!ballot || !ballot.eligible.includes(memberId)) return none
  ballot.votes[memberId] = choice
  return { ...resolveBallots(room, now), changed: true }
}

export type BallotOutcome = 'pass' | 'fail' | 'open'

/**
 * A strict majority of everyone entitled to vote — not of those who bothered.
 * Abstaining therefore counts against change, which is the right default: the
 * room only overrides a person's pause when most of the rest actively agree.
 */
export function tally(ballot: Ballot): { yes: number; no: number; needed: number; outcome: BallotOutcome } {
  const values = Object.entries(ballot.votes).filter(([id]) => ballot.eligible.includes(id))
  const yes = values.filter(([, v]) => v === 'yes').length
  const no = values.filter(([, v]) => v === 'no').length
  const needed = Math.floor(ballot.eligible.length / 2) + 1

  if (yes >= needed) return { yes, no, needed, outcome: 'pass' }
  // Once enough people have said no, the rest cannot change the result.
  if (no > ballot.eligible.length - needed) return { yes, no, needed, outcome: 'fail' }
  return { yes, no, needed, outcome: 'open' }
}

/** Apply every ballot that has been decided or has run out of time. */
export function resolveBallots(room: RoomState, now: number): Omit<Effect, 'changed'> {
  let notice: Effect['notice']
  const surviving: Ballot[] = []

  for (const ballot of room.ballots) {
    const t = tally(ballot)
    const expired = now >= ballot.closesAt
    if (t.outcome === 'open' && !expired) {
      surviving.push(ballot)
      continue
    }
    // An expired ballot without a majority fails; silence is not consent.
    const passed = t.outcome === 'pass'
    if (!passed) {
      notice = {
        level: 'info',
        title: ballot.kind === 'resume' ? 'Resume vote failed' : 'Revoke vote failed',
        desc: expired ? 'Not enough votes in time.' : undefined
      }
      continue
    }

    if (ballot.kind === 'resume') {
      room.autoResume = false
      scheduleStart(room, room.timeline.mediaTime, now)
      notice = { level: 'ok', title: 'The room voted to resume', desc: 'Starting together.' }
    } else if (ballot.targetId) {
      const target = room.members.get(ballot.targetId)
      const until = now + (ballot.durationMs ?? 5 * 60_000)
      room.restrictions = room.restrictions.filter((r) => r.memberId !== ballot.targetId)
      room.restrictions.push({
        memberId: ballot.targetId,
        until,
        reason: 'voted by the room'
      })
      const mins = Math.round((ballot.durationMs ?? 0) / 60_000)
      notice = {
        level: 'warn',
        title: `${target?.name ?? 'A watcher'} lost playback control`,
        desc: `For ${mins >= 60 ? '1 hour' : `${mins} minutes`}.`
      }
      // Their pause is no longer theirs to hold, so let the room move on.
      if (room.timeline.paused && room.timeline.pausedBy === ballot.targetId) {
        scheduleStart(room, room.timeline.mediaTime, now)
      }
    }
  }

  room.ballots = surviving
  return notice ? { notice } : {}
}

function closeBallotsOfKind(room: RoomState, kind: BallotKind): void {
  room.ballots = room.ballots.filter((b) => b.kind !== kind)
}

/** Housekeeping the relay runs on a timer: expire ballots and restrictions. */
export function tick(room: RoomState, now: number): Effect {
  const before = room.restrictions.length
  room.restrictions = room.restrictions.filter((r) => r.until > now)
  const hadBallots = room.ballots.length
  const effect = resolveBallots(room, now)
  const dirty = before !== room.restrictions.length || hadBallots !== room.ballots.length || !!effect.notice
  return { ...effect, changed: dirty }
}

export function snapshot(room: RoomState, now: number): RoomSnapshot {
  return {
    roomId: room.roomId,
    protocol: TOGETHER_PROTOCOL,
    serverTs: now,
    timeline: room.timeline,
    members: [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
    restrictions: room.restrictions,
    ballots: room.ballots,
    content: room.content
  }
}
