import { describe, expect, it } from 'vitest'
import {
  callVote,
  castVote,
  createRoom,
  intent,
  join,
  report,
  snapshot,
  tally,
  tick,
  type RoomState
} from './room'
import { GATE_LEAD_MS, isRestricted, isRollingAt, positionAt } from './protocol'

const T0 = 1_000_000

function roomWith(names: string[], now = T0): RoomState {
  const room = createRoom('ABC234', now)
  for (const n of names) join(room, n, n, { key: 'film#100', title: 'Film', durationSec: 200 }, now)
  return room
}

/** Get everyone past the ready-gate so the room is actually rolling. */
function allReady(room: RoomState, now: number): void {
  for (const id of room.members.keys()) {
    report(room, id, { ready: true, bufferedAhead: 30, driftMs: 0, rttMs: 20 }, now)
  }
}

/** Drive the room to an actually-rolling state, past the ready-gate. */
function startRolling(room: RoomState, now = T0): void {
  allReady(room, now)
  intent(room, [...room.members.keys()][0], 'play', 0, undefined, now)
  allReady(room, now + 10)
}

describe('joining', () => {
  it('makes the first arrival the owner', () => {
    const room = roomWith(['ana', 'ben'])
    expect(room.members.get('ana')?.isOwner).toBe(true)
    expect(room.members.get('ben')?.isOwner).toBe(false)
  })

  it('holds the room while a latecomer loads, then starts everyone together', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 100)
    expect(isRollingAt(room.timeline, T0 + GATE_LEAD_MS + 5_000)).toBe(true)

    // Someone new turns up 10 seconds in. The room must stop for them.
    const tJoin = T0 + GATE_LEAD_MS + 10_000
    join(room, 'cy', 'Cy', { key: 'film#100', title: 'Film', durationSec: 200 }, tJoin)
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.pauseReason).toBe('join')
    const heldAt = positionAt(room.timeline, tJoin)
    expect(heldAt).toBeCloseTo(10, 1)

    // ...and resume by itself once they have a frame, without anyone asking.
    report(room, 'cy', { ready: true, bufferedAhead: 20, driftMs: 0, rttMs: 40 }, tJoin + 4_000)
    expect(room.timeline.startAtTs).toBe(tJoin + 4_000 + GATE_LEAD_MS)
    // And from exactly where it stopped — nobody loses those ten seconds.
    expect(positionAt(room.timeline, tJoin + 4_000 + GATE_LEAD_MS)).toBeCloseTo(heldAt, 6)
  })

  it('flags a watcher whose file is a different cut', () => {
    const room = roomWith(['ana'])
    join(room, 'ben', 'Ben', { key: 'other#999', title: 'Other', durationSec: 1998 }, T0)
    expect(room.members.get('ben')?.contentMatch).toBe('mismatch')
    expect(room.members.get('ana')?.contentMatch).toBe('match')
  })

  it('keeps a reconnecting member restricted', () => {
    // Dropping the connection must not be a way to shed a revocation.
    const room = roomWith(['ana', 'ben', 'cy'])
    room.restrictions.push({ memberId: 'ben', until: T0 + 60_000, reason: 'test' })
    join(room, 'ben', 'Ben', null, T0 + 1_000)
    expect(isRestricted(room.restrictions, 'ben', T0 + 1_000)).not.toBeNull()
  })
})

describe('the ready-gate', () => {
  it('pauses the whole room when one watcher stalls', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)

    const tStall = T0 + GATE_LEAD_MS + 20_000
    report(room, 'ben', { ready: false, bufferedAhead: 0, driftMs: 0, rttMs: 30 }, tStall)
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.pauseReason).toBe('buffering')
    expect(positionAt(room.timeline, tStall + 5_000)).toBeCloseTo(20, 1)
  })

  it('resumes on its own once the straggler catches up', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)
    const tStall = T0 + GATE_LEAD_MS + 20_000
    report(room, 'ben', { ready: false, bufferedAhead: 0, driftMs: 0, rttMs: 30 }, tStall)

    report(room, 'ben', { ready: true, bufferedAhead: 15, driftMs: 0, rttMs: 30 }, tStall + 3_000)
    expect(room.timeline.startAtTs).toBe(tStall + 3_000 + GATE_LEAD_MS)
  })

  it('does not auto-resume a pause a person chose', () => {
    // The distinction that matters: buffering lifts itself, a human pause does not.
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)

    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 5_000)
    allReady(room, T0 + GATE_LEAD_MS + 6_000)
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.startAtTs).toBeNull()
  })

  it('clears everyone ready on a seek so nobody plays before the others land', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)

    intent(room, 'ana', 'seek', 500, undefined, T0 + GATE_LEAD_MS + 1_000)
    expect([...room.members.values()].every((m) => !m.ready)).toBe(true)
    expect(room.timeline.mediaTime).toBe(500)
  })
})

describe('anyone can pause', () => {
  it('lets a non-owner stop the room instantly, with no vote', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)

    const effect = intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 3_000)
    expect(effect.changed).toBe(true)
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.pausedBy).toBe('ben')
  })
})

describe('voting to resume', () => {
  it('needs a majority of everyone except the person who paused', () => {
    const room = roomWith(['ana', 'ben', 'cy', 'dee'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)
    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 1_000)

    const t = T0 + GATE_LEAD_MS + 2_000
    callVote(room, 'ana', 'resume', undefined, undefined, t)
    const ballot = room.ballots[0]
    // Ben paused, so Ben has no say. Three eligible, so two votes carry it.
    expect(ballot.eligible.sort()).toEqual(['ana', 'cy', 'dee'])
    expect(tally(ballot).needed).toBe(2)
    expect(tally(ballot).outcome).toBe('open')

    castVote(room, 'cy', ballot.id, 'yes', t + 1_000)
    expect(room.ballots).toHaveLength(0)
    expect(room.timeline.startAtTs).toBe(t + 1_000 + GATE_LEAD_MS)
  })

  it('cannot be blocked by the person who paused', () => {
    const room = roomWith(['ana', 'ben'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)
    intent(room, 'ben', 'pause', 0, undefined, T0 + 5_000)

    const t = T0 + 6_000
    callVote(room, 'ana', 'resume', undefined, undefined, t)
    // Ana is the only eligible voter and her call implies a yes, so it carries
    // at once. Ben cannot hold a two-person room hostage.
    expect(room.timeline.startAtTs).toBe(t + GATE_LEAD_MS)
  })

  it('fails when the room does not want it', () => {
    const room = roomWith(['ana', 'ben', 'cy', 'dee'])
    startRolling(room)
    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 500)
    const t = T0 + GATE_LEAD_MS + 1_000
    callVote(room, 'ana', 'resume', undefined, undefined, t)
    const id = room.ballots[0].id
    castVote(room, 'cy', id, 'no', t + 100)
    castVote(room, 'dee', id, 'no', t + 200)
    expect(room.ballots).toHaveLength(0)
    expect(room.timeline.paused).toBe(true)
  })

  it('treats silence as dissent when the window closes', () => {
    const room = roomWith(['ana', 'ben', 'cy', 'dee'])
    startRolling(room)
    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 500)
    callVote(room, 'ana', 'resume', undefined, undefined, T0 + GATE_LEAD_MS + 1_000)
    tick(room, T0 + GATE_LEAD_MS + 1_000 + 46_000)
    expect(room.ballots).toHaveLength(0)
    expect(room.timeline.paused).toBe(true)
  })

  it('refuses a duplicate ballot', () => {
    const room = roomWith(['ana', 'ben', 'cy', 'dee'])
    startRolling(room)
    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 500)
    callVote(room, 'ana', 'resume', undefined, undefined, T0 + GATE_LEAD_MS + 1_000)
    const second = callVote(room, 'cy', 'resume', undefined, undefined, T0 + GATE_LEAD_MS + 1_100)
    expect(second.deny?.reason).toBe('ballot-open')
    expect(room.ballots).toHaveLength(1)
  })
})

describe('revoking pause privileges', () => {
  const FIVE_MIN = 5 * 60_000

  it('locks the target out for the voted duration', () => {
    const room = roomWith(['ana', 'ben', 'cy'])
    const t = T0 + 1_000
    callVote(room, 'ana', 'revoke', 'ben', FIVE_MIN, t)
    const ballot = room.ballots[0]
    expect(ballot.eligible.sort()).toEqual(['ana', 'cy'])

    castVote(room, 'cy', ballot.id, 'yes', t + 500)
    const r = isRestricted(room.restrictions, 'ben', t + 500)
    expect(r?.until).toBe(t + 500 + FIVE_MIN)
  })

  it('rejects a paused attempt from a revoked watcher, with a reason', () => {
    const room = roomWith(['ana', 'ben', 'cy'])
    room.restrictions.push({ memberId: 'ben', until: T0 + FIVE_MIN, reason: 'test' })
    const effect = intent(room, 'ben', 'pause', 0, undefined, T0 + 1_000)
    expect(effect.changed).toBe(false)
    expect(effect.deny?.reason).toBe('restricted')
    expect(effect.deny?.until).toBe(T0 + FIVE_MIN)
    expect(room.timeline.pausedBy).not.toBe('ben')
  })

  it('also stops them seeking, which would be just as disruptive', () => {
    const room = roomWith(['ana', 'ben'])
    room.restrictions.push({ memberId: 'ben', until: T0 + FIVE_MIN, reason: 'test' })
    expect(intent(room, 'ben', 'seek', 900, undefined, T0 + 1).deny?.reason).toBe('restricted')
    expect(room.timeline.mediaTime).toBe(0)
  })

  it('lifts the restriction automatically when it expires', () => {
    const room = roomWith(['ana', 'ben'])
    room.restrictions.push({ memberId: 'ben', until: T0 + FIVE_MIN, reason: 'test' })
    tick(room, T0 + FIVE_MIN + 1)
    expect(room.restrictions).toHaveLength(0)

    // Ben gets his pause back with no further ceremony.
    const after = intent(room, 'ben', 'pause', 0, undefined, T0 + FIVE_MIN + 2)
    expect(after.deny).toBeUndefined()
  })

  it('releases the room when the person holding the pause is revoked', () => {
    const room = roomWith(['ana', 'ben', 'cy'])
    allReady(room, T0)
    intent(room, 'ana', 'play', 0, undefined, T0)
    allReady(room, T0 + 10)
    intent(room, 'ben', 'pause', 0, undefined, T0 + GATE_LEAD_MS + 500)
    expect(room.timeline.pausedBy).toBe('ben')

    const t = T0 + GATE_LEAD_MS + 1_000
    callVote(room, 'ana', 'revoke', 'ben', FIVE_MIN, t)
    castVote(room, 'cy', room.ballots[0].id, 'yes', t + 100)
    expect(room.timeline.startAtTs).toBe(t + 100 + GATE_LEAD_MS)
  })

  it('will not leave a room with nobody able to pause', () => {
    const room = roomWith(['ana', 'ben'])
    room.restrictions.push({ memberId: 'ana', until: T0 + FIVE_MIN, reason: 'test' })
    // Ben is the last watcher who can still stop the film. Revoking him would
    // mean nobody in the room could ever pause it again.
    const effect = callVote(room, 'ana', 'revoke', 'ben', FIVE_MIN, T0 + 1)
    expect(effect.deny?.reason).toBe('would-lock-room')
    expect(room.ballots).toHaveLength(0)
  })

  it('does not let the target vote on their own revocation', () => {
    const room = roomWith(['ana', 'ben', 'cy'])
    callVote(room, 'ana', 'revoke', 'ben', FIVE_MIN, T0 + 1)
    const ballot = room.ballots[0]
    expect(ballot.eligible).not.toContain('ben')
    castVote(room, 'ben', ballot.id, 'no', T0 + 2)
    expect(ballot.votes.ben).toBeUndefined()
  })
})

describe('snapshots', () => {
  it('reports members oldest first so the list does not jump around', () => {
    const room = createRoom('ABC234', T0)
    join(room, 'ana', 'Ana', null, T0)
    join(room, 'ben', 'Ben', null, T0 + 500)
    join(room, 'cy', 'Cy', null, T0 + 200)
    expect(snapshot(room, T0 + 1_000).members.map((m) => m.id)).toEqual(['ana', 'cy', 'ben'])
  })
})
