// Estimating the offset between this machine's clock and the relay's.
//
// Everything downstream depends on this number. If we think the server clock
// is 80ms ahead of where it really is, every watcher in the room sits 80ms
// off the timeline and no amount of drift correction will find it — the
// controller would be steering confidently towards the wrong target.

/** One completed ping/pong exchange. */
export interface ClockSample {
  /** Round-trip time, ms. */
  rtt: number
  /** serverClock - localClock implied by this sample, ms. */
  offset: number
}

export function sampleFrom(clientTs: number, serverTs: number, receivedTs: number): ClockSample {
  const rtt = receivedTs - clientTs
  // Assume the request and response legs took the same time. That assumption
  // is wrong on asymmetric links, which is exactly why we keep the *lowest*
  // RTT sample below rather than averaging: the fastest exchange is the one
  // least distorted by queueing in one direction.
  const offset = serverTs - (clientTs + rtt / 2)
  return { rtt, offset }
}

export const CLOCK_WINDOW = 12
/** Below this RTT spread we consider the estimate trustworthy. */
export const CLOCK_GOOD_RTT_MS = 400

export interface ClockEstimate {
  offsetMs: number
  rttMs: number
  /** True once we have enough clean samples to steer on. */
  settled: boolean
}

/**
 * Minimum-RTT filter, the same trick NTP uses. Averaging offsets sounds more
 * robust but is not: a single congested exchange drags the mean, while the
 * quickest round trip in the window is necessarily the least contaminated by
 * queueing delay. We take the median offset of the fastest third to get one
 * outlier's worth of protection without reintroducing that bias.
 */
export function estimateClock(samples: ClockSample[]): ClockEstimate {
  if (samples.length === 0) return { offsetMs: 0, rttMs: 0, settled: false }

  // Sort by RTT, but break ties towards the newest sample. On a stable link
  // every round trip measures nearly the same, so without the tie-break the
  // filter would keep re-selecting the oldest exchanges and a real change in
  // the offset — a machine waking, an NTP correction — would never be seen.
  const indexed = samples.map((s, i) => ({ s, i }))
  const byRtt = indexed.sort((a, b) => a.s.rtt - b.s.rtt || b.i - a.i).map((x) => x.s)
  const take = Math.max(1, Math.ceil(byRtt.length / 3))
  const fastest = byRtt.slice(0, take)

  const offsets = fastest.map((s) => s.offset).sort((a, b) => a - b)
  const mid = Math.floor(offsets.length / 2)
  const offsetMs =
    offsets.length % 2 === 1 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2

  return {
    offsetMs,
    rttMs: byRtt[0].rtt,
    settled: samples.length >= 4 && byRtt[0].rtt <= CLOCK_GOOD_RTT_MS
  }
}

/**
 * A rolling clock, fed by pongs. Deliberately *slews* rather than steps: a
 * sudden correction to the offset would shift the sync target under the drift
 * controller's feet, and it would chase the jump with a seek the viewer sees.
 * Moving a fraction of the way each time keeps the target continuous.
 */
export class ClockSync {
  private samples: ClockSample[] = []
  private smoothed: number | null = null
  private estimate: ClockEstimate = { offsetMs: 0, rttMs: 0, settled: false }

  add(sample: ClockSample): void {
    this.samples.push(sample)
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift()
    this.estimate = estimateClock(this.samples)

    const target = this.estimate.offsetMs
    if (this.smoothed === null) {
      this.smoothed = target
      return
    }
    // Big genuine jumps (a laptop waking, an NTP step) must not take minutes
    // to track, so snap when the gap is far past anything jitter explains.
    if (Math.abs(target - this.smoothed) > 750) this.smoothed = target
    else this.smoothed += (target - this.smoothed) * 0.25
  }

  /** serverClock - localClock, ms. */
  get offsetMs(): number {
    return this.smoothed ?? 0
  }
  get rttMs(): number {
    return this.estimate.rttMs
  }
  get settled(): boolean {
    return this.estimate.settled && this.smoothed !== null
  }

  /** The relay's clock, as best we can tell, right now. */
  serverNow(localNow: number = Date.now()): number {
    return localNow + this.offsetMs
  }

  reset(): void {
    this.samples = []
    this.smoothed = null
    this.estimate = { offsetMs: 0, rttMs: 0, settled: false }
  }
}
