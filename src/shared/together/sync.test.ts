import { describe, expect, it } from 'vitest'
import { ClockSync, estimateClock, sampleFrom } from './clock'
import {
  DEADBAND_SEC,
  MAX_NUDGE,
  SEEK_COOLDOWN_MS,
  decideCorrection,
  initialDriftState,
  type DriftState
} from './drift'
import { contentKey, contentMatches, isRollingAt, positionAt, type Timeline } from './protocol'

describe('clock estimation', () => {
  it('recovers a known offset from a symmetric exchange', () => {
    // Server clock runs 5000ms ahead; the round trip takes 100ms.
    const s = sampleFrom(1_000, 6_050, 1_100)
    expect(s.rtt).toBe(100)
    expect(s.offset).toBe(5000)
  })

  it('prefers the fastest exchange over the average', () => {
    // Four clean samples at 5000, plus one badly queued sample that would
    // drag a mean well off. The minimum-RTT filter must ignore it.
    const samples = [
      { rtt: 40, offset: 5000 },
      { rtt: 44, offset: 5002 },
      { rtt: 50, offset: 4998 },
      { rtt: 60, offset: 5001 },
      { rtt: 900, offset: 5400 }
    ]
    const est = estimateClock(samples)
    expect(Math.abs(est.offsetMs - 5000)).toBeLessThan(5)
    expect(est.rttMs).toBe(40)
    expect(est.settled).toBe(true)
  })

  it('does not claim to be settled on one noisy sample', () => {
    expect(estimateClock([{ rtt: 1200, offset: 500 }]).settled).toBe(false)
  })

  it('ignores a lone outlier rather than chasing it', () => {
    const clock = new ClockSync()
    for (let i = 0; i < 8; i++) clock.add({ rtt: 50, offset: 1000 })
    expect(Math.abs(clock.offsetMs - 1000)).toBeLessThan(1)

    // One odd sample among many good ones is noise, not news. Reacting to it
    // would shift the sync target and make every client twitch in unison.
    clock.add({ rtt: 50, offset: 1200 })
    expect(Math.abs(clock.offsetMs - 1000)).toBeLessThan(30)
  })

  it('slews to a sustained shift instead of stepping', () => {
    const clock = new ClockSync()
    for (let i = 0; i < 8; i++) clock.add({ rtt: 50, offset: 1000 })
    // A real 200ms change, held. It must be tracked — but gradually, or the
    // drift controller sees a phantom gap open and seeks to close it.
    clock.add({ rtt: 50, offset: 1200 })
    clock.add({ rtt: 50, offset: 1200 })
    clock.add({ rtt: 50, offset: 1200 })
    const partway = clock.offsetMs
    expect(partway).toBeGreaterThan(1000)
    expect(partway).toBeLessThan(1200)

    for (let i = 0; i < 12; i++) clock.add({ rtt: 50, offset: 1200 })
    expect(Math.abs(clock.offsetMs - 1200)).toBeLessThan(5)
  })

  it('snaps when the clock genuinely jumps', () => {
    const clock = new ClockSync()
    for (let i = 0; i < 8; i++) clock.add({ rtt: 50, offset: 0 })
    // A machine waking from sleep: tracking this slowly would leave the room
    // steering at a target that is seconds wrong for minutes.
    for (let i = 0; i < 8; i++) clock.add({ rtt: 50, offset: 30_000 })
    expect(Math.abs(clock.offsetMs - 30_000)).toBeLessThan(500)
  })
})

describe('timeline arithmetic', () => {
  const base: Timeline = {
    epoch: 1,
    mediaTime: 100,
    anchorTs: 10_000,
    rate: 1,
    paused: false,
    startAtTs: null,
    pausedBy: null,
    pauseReason: null
  }

  it('advances with the server clock while playing', () => {
    expect(positionAt(base, 12_000)).toBeCloseTo(102, 6)
  })

  it('scales with playback rate', () => {
    expect(positionAt({ ...base, rate: 2 }, 12_000)).toBeCloseTo(104, 6)
  })

  it('holds still while paused', () => {
    expect(positionAt({ ...base, paused: true }, 99_000)).toBe(100)
  })

  it('holds at the gate, then releases exactly on time', () => {
    const gated: Timeline = { ...base, paused: true, startAtTs: 11_000 }
    expect(isRollingAt(gated, 10_999)).toBe(false)
    expect(positionAt(gated, 10_999)).toBe(100)
    expect(isRollingAt(gated, 11_000)).toBe(true)
    expect(positionAt(gated, 11_000)).toBe(100)
    expect(positionAt(gated, 13_000)).toBeCloseTo(102, 6)
  })

  it('puts two clients with different local clocks on the same frame', () => {
    // Same server timeline, two machines whose clocks differ by 4 seconds.
    // Each converts through its own offset, so both must agree on position.
    const gated: Timeline = { ...base, paused: true, startAtTs: 11_000 }
    const localA = 20_000
    const offsetA = 11_500 - localA // server is 8500ms behind A's clock
    const localB = 5_000
    const offsetB = 11_500 - localB
    expect(positionAt(gated, localA + offsetA)).toBeCloseTo(positionAt(gated, localB + offsetB), 9)
  })
})

describe('drift correction', () => {
  const rolling = (localTime: number, targetTime: number, now = 100_000): Parameters<typeof decideCorrection>[0] => ({
    localTime,
    targetTime,
    rolling: true,
    now
  })

  it('leaves an in-sync client completely alone', () => {
    const { correction } = decideCorrection(rolling(100, 100.01), initialDriftState())
    expect(correction.action).toBe('hold')
    expect(correction.rateMultiplier).toBe(1)
  })

  it('slows down when ahead and speeds up when behind', () => {
    const ahead = decideCorrection(rolling(100.2, 100), initialDriftState()).correction
    expect(ahead.action).toBe('nudge')
    expect(ahead.rateMultiplier).toBeLessThan(1)

    const behind = decideCorrection(rolling(100, 100.2), initialDriftState()).correction
    expect(behind.action).toBe('nudge')
    expect(behind.rateMultiplier).toBeGreaterThan(1)
  })

  it('never nudges hard enough to be audible', () => {
    // Even at the edge of the nudge band the tempo change stays under 5%.
    const c = decideCorrection(rolling(100.59, 100), initialDriftState()).correction
    expect(Math.abs(c.rateMultiplier - 1)).toBeLessThanOrEqual(MAX_NUDGE + 1e-9)
  })

  it('converges on the room without ever seeking', () => {
    // The behaviour that matters: simulate a client 250ms ahead and let the
    // controller run. It must reach the deadband, and must do it with rate
    // alone — a seek here is the audio glitch we are avoiding.
    let local = 100.25
    let target = 100
    let state = initialDriftState()
    let seeks = 0
    const step = 0.25 // controller ticks 4x a second

    for (let i = 0; i < 200; i++) {
      const { correction, state: next } = decideCorrection(rolling(local, target, 100_000 + i * 250), state)
      state = next
      if (correction.action === 'seek') seeks++
      local += step * correction.rateMultiplier
      target += step
      if (Math.abs(local - target) <= DEADBAND_SEC && correction.action === 'hold') break
    }

    expect(seeks).toBe(0)
    expect(Math.abs(local - target)).toBeLessThanOrEqual(DEADBAND_SEC)
  })

  it('does not oscillate once it has converged', () => {
    // Sitting exactly on the deadband edge must not flip between nudge and
    // hold forever; the release threshold is what stops the tempo wobbling.
    let state: DriftState = { correcting: true, overshoots: 0, lastSeekAt: 0, lastSeekTarget: null }
    const first = decideCorrection(rolling(100.02, 100), state)
    state = first.state
    expect(first.correction.action).toBe('nudge')

    const settled = decideCorrection(rolling(100.005, 100), state)
    expect(settled.correction.action).toBe('hold')
    expect(settled.state.correcting).toBe(false)
  })

  it('refuses to seek on a single bad reading', () => {
    // One stale time report must never produce a visible jump.
    const { correction, state } = decideCorrection(rolling(105, 100), initialDriftState())
    expect(correction.action).toBe('nudge')
    expect(state.overshoots).toBe(1)
  })

  it('seeks once a large gap is confirmed', () => {
    let state = initialDriftState()
    let last = decideCorrection(rolling(105, 100), state)
    state = last.state
    last = decideCorrection(rolling(105, 100), state)
    state = last.state
    last = decideCorrection(rolling(105, 100), state)

    expect(last.correction.action).toBe('seek')
    expect(last.correction.seekTo).toBeGreaterThan(100)
    expect(last.state.overshoots).toBe(0)
  })

  it('will not seek twice in quick succession', () => {
    let state: DriftState = { correcting: false, overshoots: 5, lastSeekAt: 100_000, lastSeekTarget: null }
    const soon = decideCorrection(rolling(105, 100, 100_000 + SEEK_COOLDOWN_MS - 1), state)
    expect(soon.correction.action).toBe('nudge')

    state = { correcting: false, overshoots: 5, lastSeekAt: 100_000, lastSeekTarget: null }
    const later = decideCorrection(rolling(105, 100, 100_000 + SEEK_COOLDOWN_MS + 1), state)
    expect(later.correction.action).toBe('seek')
  })

  it('realigns immediately while paused, where a seek is free', () => {
    const { correction } = decideCorrection(
      { localTime: 100.4, targetTime: 100, rolling: false, now: 1 },
      initialDriftState()
    )
    // No audio is playing, so there is no glitch to avoid — snap to the frame.
    expect(correction.action).toBe('seek')
    expect(correction.seekTo).toBe(100)
  })

  it('does not re-seek a paused room it has already snapped', () => {
    // The resync loop: engines land on frame boundaries, and one frame of
    // 24fps content (42ms) is wider than the deadband, so the gap never
    // closes. Asking again every tick seeks forever and flushes the buffer
    // each time, dropping this client out of the room's ready-gate.
    const target = 100
    let state = initialDriftState()
    let local = 100.4
    let seeks = 0

    for (let i = 0; i < 400; i++) {
      const { correction, state: next } = decideCorrection(
        { localTime: local, targetTime: target, rolling: false, now: 100_000 + i * 250 },
        state
      )
      state = next
      if (correction.action === 'seek') {
        seeks++
        // The engine snaps to the nearest frame it holds, one frame short.
        local = (correction.seekTo ?? target) - 1 / 24
      }
    }

    expect(seeks).toBe(1)
  })

  it('realigns again when a paused room moves to a new position', () => {
    let state = initialDriftState()
    const first = decideCorrection(
      { localTime: 100.4, targetTime: 100, rolling: false, now: 100_000 },
      state
    )
    state = first.state
    expect(first.correction.action).toBe('seek')

    // Somebody scrubbed. The target moved, so this is a fresh alignment and
    // must not be swallowed by the repeat guard.
    const moved = decideCorrection(
      { localTime: 99.96, targetTime: 400, rolling: false, now: 100_250 },
      state
    )
    expect(moved.correction.action).toBe('seek')
    expect(moved.correction.seekTo).toBe(400)
  })

  it('retries a paused seek the engine plainly ignored, but not fast', () => {
    let state = initialDriftState()
    const first = decideCorrection(
      { localTime: 400, targetTime: 100, rolling: false, now: 100_000 },
      state
    )
    state = first.state
    expect(first.correction.action).toBe('seek')

    // Still 300s out: the seek never took. Hold until the cooldown expires.
    const soon = decideCorrection(
      { localTime: 400, targetTime: 100, rolling: false, now: 100_000 + SEEK_COOLDOWN_MS - 1 },
      state
    )
    expect(soon.correction.action).toBe('hold')

    const later = decideCorrection(
      { localTime: 400, targetTime: 100, rolling: false, now: 100_000 + SEEK_COOLDOWN_MS + 1 },
      state
    )
    expect(later.correction.action).toBe('seek')
  })
})

describe('content matching', () => {
  const ref = (title: string, durationSec: number) => ({
    key: contentKey(title),
    title,
    durationSec
  })

  it('matches two differently-named rips of the same film', () => {
    expect(contentMatches(ref('The.Matrix.1999.1080p.x265.mkv', 8148), ref('The Matrix 1999 BluRay', 8149))).toBe(true)
  })

  it('is not fooled by a bucket boundary', () => {
    // The failure mode of hashing a rounded duration: two runtimes a second
    // apart landing either side of an edge and being called different films.
    for (let d = 7000; d < 7020; d++) {
      expect(contentMatches(ref('Blade Runner', d), ref('Blade Runner', d + 1))).toBe(true)
    }
  })

  it('separates different cuts of the same film', () => {
    expect(contentMatches(ref('Blade Runner', 7020), ref('Blade Runner', 7800))).toBe(false)
  })

  it('separates different films of the same length', () => {
    expect(contentMatches(ref('Heat', 6000), ref('Casino', 6000))).toBe(false)
  })
})
