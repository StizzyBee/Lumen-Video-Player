import { describe, expect, it } from 'vitest'
import { decideReadiness, READY_HIGH_SEC } from './readiness'
import { createRoom, intent, join, report, type RoomState } from './room'
import { positionAt } from './protocol'

const base = { hasItem: true, status: 'playing', bufferedAhead: 10, wasReady: true }

describe('readiness', () => {
  it('is false with nothing loaded, or while the engine admits it cannot play', () => {
    expect(decideReadiness({ ...base, hasItem: false })).toBe(false)
    for (const status of ['loading', 'buffering', 'error']) {
      expect(decideReadiness({ ...base, status })).toBe(false)
    }
  })

  it('does NOT depend on being paused', () => {
    // The whole bug in one assertion. If pausing changed the answer, the room
    // would pause a starving client, see it turn "ready", resume, and repeat.
    const starving = { hasItem: true, bufferedAhead: 0, wasReady: false }
    expect(decideReadiness({ ...starving, status: 'paused' })).toBe(
      decideReadiness({ ...starving, status: 'playing' })
    )

    const healthy = { hasItem: true, bufferedAhead: 30, wasReady: true }
    expect(decideReadiness({ ...healthy, status: 'paused' })).toBe(true)
    expect(decideReadiness({ ...healthy, status: 'playing' })).toBe(true)
  })

  it('trusts an engine that cannot report buffer ranges', () => {
    // mpv renders out of process and signals stalls through status. Reading
    // "no ranges" as "no data" would leave it permanently holding the gate.
    expect(decideReadiness({ ...base, bufferedAhead: null, wasReady: false })).toBe(true)
    expect(decideReadiness({ ...base, bufferedAhead: null, status: 'buffering' })).toBe(false)
  })

  it('needs more buffer to recover than to fall over', () => {
    // A plain threshold makes a client near the line flap once per report.
    expect(decideReadiness({ ...base, bufferedAhead: 1, wasReady: true })).toBe(true)
    expect(decideReadiness({ ...base, bufferedAhead: 1, wasReady: false })).toBe(false)
    expect(decideReadiness({ ...base, bufferedAhead: READY_HIGH_SEC, wasReady: false })).toBe(true)
  })
})

// ── The regression this file exists for ─────────────────────────────────────

const T0 = 2_000_000

/**
 * A watcher driven by the real readiness rule, so the room and the client
 * form the same closed loop they do in the app.
 */
class FakeWatcher {
  ready = false
  constructor(
    readonly id: string,
    /** Seconds buffered ahead — the thing that actually gates playback. */
    public buffer: number
  ) {}

  /** Report to the room the way the renderer's 1s heartbeat does. */
  tick(room: RoomState, now: number, paused: boolean): void {
    this.ready = decideReadiness({
      hasItem: true,
      status: paused ? 'paused' : 'playing',
      bufferedAhead: this.buffer,
      wasReady: this.ready
    })
    report(room, this.id, { ready: this.ready, bufferedAhead: this.buffer, driftMs: 0, rttMs: 20 }, now)
  }
}

describe('the room does not flap between paused and playing', () => {
  it('settles instead of cycling when a watcher cannot keep up', () => {
    const room = createRoom('ABC234', T0)
    const ana = new FakeWatcher('ana', 30)
    const ben = new FakeWatcher('ben', 30)
    for (const w of [ana, ben]) join(room, w.id, w.id, null, T0)

    let now = T0
    const step = () => {
      const paused = room.timeline.paused && (room.timeline.startAtTs === null || now < room.timeline.startAtTs)
      for (const w of [ana, ben]) w.tick(room, now, paused)
      now += 1000
    }

    // Get everyone loaded and playing.
    step()
    step()
    intent(room, 'ana', 'play', 0, undefined, now)
    step()

    // Ben's connection degrades and simply stays degraded.
    ben.buffer = 0

    const transitions: boolean[] = []
    let last = room.timeline.paused
    for (let i = 0; i < 40; i++) {
      step()
      if (room.timeline.paused !== last) {
        transitions.push(room.timeline.paused)
        last = room.timeline.paused
      }
    }

    // Ben never recovers, so the correct behaviour is: pause once, and wait.
    // Before the fix this produced a pause/resume pair on every single report
    // — the video visibly stuttering between paused and playing forever.
    expect(transitions.length).toBeLessThanOrEqual(1)
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.pauseReason).toBe('buffering')
  })

  it('resumes once, and only once, when the watcher genuinely recovers', () => {
    const room = createRoom('ABC234', T0)
    const ana = new FakeWatcher('ana', 30)
    const ben = new FakeWatcher('ben', 30)
    for (const w of [ana, ben]) join(room, w.id, w.id, null, T0)

    let now = T0
    const step = () => {
      const paused = room.timeline.paused && (room.timeline.startAtTs === null || now < room.timeline.startAtTs)
      for (const w of [ana, ben]) w.tick(room, now, paused)
      now += 1000
    }

    step()
    step()
    intent(room, 'ana', 'play', 0, undefined, now)
    step()

    ben.buffer = 0
    step()
    step()
    expect(room.timeline.paused).toBe(true)

    // Ben's buffer refills past the recovery threshold.
    ben.buffer = 12
    step()
    step()
    expect(room.timeline.startAtTs).not.toBeNull()

    // And it stays running rather than immediately stalling again.
    let flips = 0
    let last = room.timeline.paused
    for (let i = 0; i < 20; i++) {
      step()
      if (room.timeline.paused !== last) {
        flips++
        last = room.timeline.paused
      }
    }
    expect(flips).toBe(0)
  })

  it('holds position across the stall instead of losing the scene', () => {
    const room = createRoom('ABC234', T0)
    const ana = new FakeWatcher('ana', 30)
    const ben = new FakeWatcher('ben', 30)
    for (const w of [ana, ben]) join(room, w.id, w.id, null, T0)

    let now = T0
    const step = () => {
      const paused = room.timeline.paused && (room.timeline.startAtTs === null || now < room.timeline.startAtTs)
      for (const w of [ana, ben]) w.tick(room, now, paused)
      now += 1000
    }
    step()
    step()
    intent(room, 'ana', 'play', 0, undefined, now)
    step()

    const beforeStall = positionAt(room.timeline, now)
    ben.buffer = 0
    step()
    const held = positionAt(room.timeline, now + 5_000)
    expect(held).toBeGreaterThanOrEqual(beforeStall)
    // Frozen: five seconds of waiting must not advance the film.
    expect(positionAt(room.timeline, now + 10_000)).toBe(held)
  })

  it('a watcher pause is never undone by the room on its own', () => {
    // The other half of the report: "when I pause it, it keeps unpausing."
    const room = createRoom('ABC234', T0)
    const ana = new FakeWatcher('ana', 30)
    const ben = new FakeWatcher('ben', 30)
    for (const w of [ana, ben]) join(room, w.id, w.id, null, T0)

    let now = T0
    const step = () => {
      const paused = room.timeline.paused && (room.timeline.startAtTs === null || now < room.timeline.startAtTs)
      for (const w of [ana, ben]) w.tick(room, now, paused)
      now += 1000
    }
    step()
    step()
    intent(room, 'ana', 'play', 0, undefined, now)
    step()
    step()

    intent(room, 'ben', 'pause', 0, undefined, now)
    expect(room.timeline.pausedBy).toBe('ben')

    // Everyone keeps reporting in with a healthy buffer, which is exactly the
    // condition that used to trip the auto-resume.
    for (let i = 0; i < 15; i++) step()
    expect(room.timeline.paused).toBe(true)
    expect(room.timeline.pausedBy).toBe('ben')
    expect(room.timeline.startAtTs).toBeNull()
  })
})

describe('an out-of-date watcher cannot strobe the room', () => {
  it('damps a client that still reports ready whenever it is paused', () => {
    // 0.3.0 shipped the looping rule, so a friend on the old build behaves
    // exactly like this. The room must not stop and start once per heartbeat
    // just because one participant has not updated.
    const room = createRoom('ABC234', T0)
    for (const id of ['ana', 'ben']) join(room, id, id, null, T0)

    let now = T0
    let anaReady = false
    const oldClientReady = (paused: boolean): boolean => (paused ? true : false)

    const step = (): void => {
      const paused =
        room.timeline.paused && (room.timeline.startAtTs === null || now < room.timeline.startAtTs)
      anaReady = decideReadiness({
        hasItem: true,
        status: paused ? 'paused' : 'playing',
        bufferedAhead: 30,
        wasReady: anaReady
      })
      report(room, 'ana', { ready: anaReady, bufferedAhead: 30, driftMs: 0, rttMs: 20 }, now)
      // Ben runs the old rule and has no buffer at all.
      report(room, 'ben', { ready: oldClientReady(paused), bufferedAhead: 0, driftMs: 0, rttMs: 20 }, now)
      now += 1000
    }

    step()
    step()
    intent(room, 'ana', 'play', 0, undefined, now)
    step()

    let flips = 0
    let last = room.timeline.paused
    const start = now
    for (let i = 0; i < 30; i++) {
      step()
      if (room.timeline.paused !== last) {
        flips++
        last = room.timeline.paused
      }
    }

    // Over 30 seconds, the cooldown caps how often the room can be stopped.
    // Uncapped this was one pause and one resume per second: 60 flips.
    const seconds = (now - start) / 1000
    expect(flips).toBeLessThanOrEqual(Math.ceil(seconds / 3) * 2)
    expect(flips).toBeLessThan(30)
  })
})
