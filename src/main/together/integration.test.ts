// End-to-end check over real sockets: a real relay, real clients, real clock
// estimation. The pure unit tests prove the maths; this proves the maths is
// actually wired to the wire.

import { afterEach, describe, expect, it } from 'vitest'
import { TogetherClient } from './client'
import { TogetherRelay } from './relay'
import type { TogetherEvent } from '@shared/together/api'
import { GATE_LEAD_MS, isRollingAt, positionAt, type RoomSnapshot } from '@shared/together/protocol'
import { decideCorrection, initialDriftState, DEADBAND_SEC } from '@shared/together/drift'

let relay: TogetherRelay | null = null
const clients: TogetherClient[] = []

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect(false)
  relay?.stop()
  relay = null
})

/** A client plus the state it has been told about, for assertions. */
interface Harness {
  client: TogetherClient
  room: () => RoomSnapshot | null
  offset: () => number
  settled: () => boolean
  events: TogetherEvent[]
}

function makeClient(url: string, roomId: string, memberId: string, name: string): Harness {
  let room: RoomSnapshot | null = null
  let offset = 0
  let settled = false
  const events: TogetherEvent[] = []

  const client = new TogetherClient((e) => {
    events.push(e)
    if (e.type === 'room') {
      room = e.room
      offset = e.clockOffsetMs
      settled = e.settled
    } else if (e.type === 'clock') {
      offset = e.clockOffsetMs
      settled = e.settled
    }
  })
  clients.push(client)
  client.connect({ url, roomId, memberId, name, content: { key: 'film', title: 'Film', durationSec: 5400 } })

  return { client, room: () => room, offset: () => offset, settled: () => settled, events }
}

async function until(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function startRelay(): Promise<{ url: string; roomId: string }> {
  // Port 0 lets the OS pick a free one, so the suite never collides with a
  // real Lumen instance already hosting on the default port.
  relay = new TogetherRelay({ port: 0, host: '127.0.0.1', seedRoom: 'TEST23' })
  const started = await relay.start()
  return { url: `ws://127.0.0.1:${started.port}`, roomId: started.roomId }
}

describe('relay end to end', () => {
  it('puts two watchers on one timeline', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')

    await until(() => (ana.room()?.members.length ?? 0) === 2 && (ben.room()?.members.length ?? 0) === 2)

    // Both must be told the same thing about who is in the room.
    expect(ana.room()?.members.map((m) => m.id).sort()).toEqual(['ana', 'ben'])
    expect(ana.room()?.roomId).toBe(roomId)
    expect(ana.room()?.members.find((m) => m.id === 'ana')?.isOwner).toBe(true)
  })

  it('settles a clock estimate over a real socket', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')

    await until(() => ana.settled(), 12_000)
    // Loopback: the two clocks are the same clock, so the offset must land
    // near zero. A large value here would mean the estimator is broken.
    expect(Math.abs(ana.offset())).toBeLessThan(50)
  }, 20_000)

  it('starts both watchers at the same instant after a play', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')
    await until(() => (ana.room()?.members.length ?? 0) === 2)

    // Everyone reports ready, then Ana presses play.
    ana.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    ben.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    await until(() => !!ana.room()?.members.every((m) => m.ready))

    ana.client.intent('play', 0)
    await until(() => ana.room()?.timeline.startAtTs !== null && ben.room()?.timeline.startAtTs !== null)

    const a = ana.room()!.timeline
    const b = ben.room()!.timeline
    // The gate is a shared absolute instant, not a per-client delay. If these
    // differed, watchers would start staggered by their ping times — exactly
    // the failure this design exists to prevent.
    expect(a.startAtTs).toBe(b.startAtTs)
    expect(a.epoch).toBe(b.epoch)

    // And it is genuinely in the future when issued, so nobody starts late.
    expect(a.startAtTs! - a.anchorTs).toBe(GATE_LEAD_MS)

    const at = a.startAtTs! + 10_000
    expect(positionAt(a, at)).toBeCloseTo(positionAt(b, at), 9)
    expect(isRollingAt(a, at)).toBe(true)
  })

  it('holds the room for a watcher who stalls, then resumes by itself', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')
    await until(() => (ana.room()?.members.length ?? 0) === 2)

    ana.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    ben.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    await until(() => !!ana.room()?.members.every((m) => m.ready))
    ana.client.intent('play', 0)
    await until(() => ana.room()?.timeline.startAtTs !== null)

    // Ben's video stalls.
    ben.client.report({ ready: false, bufferedAhead: 0, mediaTime: 12, driftMs: 0 })
    await until(() => ana.room()?.timeline.pauseReason === 'buffering')
    expect(ana.room()?.timeline.paused).toBe(true)

    // ...and recovers. Nobody had to press anything.
    ben.client.report({ ready: true, bufferedAhead: 20, mediaTime: 12, driftMs: 0 })
    await until(() => ana.room()?.timeline.startAtTs !== null && !ana.room()?.timeline.pauseReason)
  })

  it('refuses a revoked watcher and tells them why', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')
    const cy = makeClient(url, roomId, 'cy', 'Cy')
    await until(() => (ana.room()?.members.length ?? 0) === 3)

    // Ana calls the vote (an implied yes); Cy carries it. Ben has no say.
    ana.client.callVote('revoke', 'ben', 5 * 60_000)
    await until(() => (ana.room()?.ballots.length ?? 0) === 1)
    const ballotId = ana.room()!.ballots[0].id
    expect(ana.room()!.ballots[0].eligible).not.toContain('ben')

    cy.client.vote(ballotId, 'yes')
    await until(() => (ana.room()?.restrictions.length ?? 0) === 1)
    expect(ana.room()!.restrictions[0].memberId).toBe('ben')

    // Ben's pause must now bounce, with an explanation rather than silence.
    ben.client.intent('pause', 40)
    await until(() => ben.events.some((e) => e.type === 'denied'))
    const denial = ben.events.find((e) => e.type === 'denied')
    expect(denial).toMatchObject({ reason: 'restricted' })
    expect(ana.room()?.timeline.pausedBy).not.toBe('ben')
  })

  it('lets the room vote a pause away', async () => {
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')
    await until(() => (ana.room()?.members.length ?? 0) === 2)

    ana.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    ben.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    await until(() => !!ana.room()?.members.every((m) => m.ready))
    ana.client.intent('play', 0)
    await until(() => ana.room()?.timeline.startAtTs !== null)
    await new Promise((r) => setTimeout(r, GATE_LEAD_MS + 100))

    ben.client.intent('pause', 5)
    await until(() => ana.room()?.timeline.pausedBy === 'ben')

    // Ana is the only other watcher, so her call decides it immediately.
    ana.client.callVote('resume')
    await until(() => ana.room()?.timeline.startAtTs !== null)
    expect(ana.room()?.timeline.pausedBy).toBeNull()
  })
})

describe('two simulated watchers converging', () => {
  it('pulls a lagging watcher back onto the frame without a seek', async () => {
    // The end-to-end claim, exercised against a live timeline: a client whose
    // decoder runs 0.4% slow than the room drifts steadily behind, and the
    // controller must reel it in using rate alone.
    const { url, roomId } = await startRelay()
    const ana = makeClient(url, roomId, 'ana', 'Ana')
    const ben = makeClient(url, roomId, 'ben', 'Ben')
    await until(() => (ana.room()?.members.length ?? 0) === 2)

    ana.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    ben.client.report({ ready: true, bufferedAhead: 30, mediaTime: 0, driftMs: 0 })
    await until(() => !!ana.room()?.members.every((m) => m.ready))
    ana.client.intent('play', 0)
    await until(() => ben.room()?.timeline.startAtTs !== null)
    await until(() => ben.settled(), 12_000)

    const timeline = ben.room()!.timeline
    const offset = ben.offset()

    // Ben starts 300ms behind and his decoder loses a further 4ms/s.
    let benTime = 0
    let state = initialDriftState()
    let seeks = 0
    let started = false

    const stepMs = 250
    let virtualNow = timeline.startAtTs! + 1000
    for (let i = 0; i < 400; i++) {
      const target = positionAt(timeline, virtualNow)
      if (!started) {
        benTime = Math.max(0, target - 0.3)
        started = true
      }

      const { correction, state: next } = decideCorrection(
        { localTime: benTime, targetTime: target, rolling: true, now: virtualNow - offset },
        state
      )
      state = next
      if (correction.action === 'seek') {
        seeks++
        benTime = correction.seekTo!
      } else {
        // Advance Ben's playhead at the corrected rate, minus his decoder's
        // persistent 0.4% shortfall.
        benTime += (stepMs / 1000) * correction.rateMultiplier * 0.996
      }
      // Advance the clock last, so the final comparison below weighs Ben's
      // playhead against the target for the same instant rather than the one
      // before it.
      virtualNow += stepMs
    }

    const finalTarget = positionAt(timeline, virtualNow)
    expect(seeks).toBe(0)
    // Converged and *stayed* converged despite a decoder that never stops
    // losing time — the steady-state error the rate loop exists to absorb.
    expect(Math.abs(benTime - finalTarget)).toBeLessThanOrEqual(DEADBAND_SEC * 2)
  }, 20_000)
})
