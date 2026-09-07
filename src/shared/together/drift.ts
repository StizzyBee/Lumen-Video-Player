// The drift controller — the part that makes "same room" literally true.
//
// Two people watching the same file on two machines will separate. Decoders
// finish frames at fractionally different rates, dropped frames are not
// recovered, and audio clocks tick at slightly different speeds. Left alone,
// a few tens of milliseconds per minute compounds into a visible gap by the
// third act.
//
// The naive fix is to seek back onto the timeline whenever you notice. Do not
// do that. A seek tears down and re-primes the audio device: you get a click,
// a few dropped frames, and — because audio and video resume from slightly
// different points — the "audio is early/late" artefact that makes shared
// viewing feel broken. Seeking every 20 seconds to stay in sync produces a
// worse experience than the drift it corrects.
//
// So: correct with *rate*. Playing at 1.02x for four seconds retires 80ms of
// drift with the audio pipeline never interrupted, and with `preservesPitch`
// on there is no pitch shift to hear. Seeking is the last resort, reserved
// for gaps a nudge cannot close in reasonable time.

/** Inside this, we are as synchronized as the measurement can prove. */
export const DEADBAND_SEC = 0.03
/** Once nudging, keep going until well inside the deadband — kills chatter. */
export const RELEASE_SEC = 0.012
/** Past this, a nudge would take too long or be audible. Seek instead. */
export const SEEK_SEC = 0.6
/** Hard ceiling on rate correction. Beyond ~5% the tempo change is audible. */
export const MAX_NUDGE = 0.05
/** Seconds we aim to take retiring the current drift. */
export const CONVERGE_SEC = 4
/** Never seek more often than this — thrashing is worse than being 0.6s off. */
export const SEEK_COOLDOWN_MS = 3000
/** Consecutive over-threshold readings required before we believe a big gap. */
export const SEEK_CONFIRMATIONS = 3

export type CorrectionAction = 'hold' | 'nudge' | 'seek'

export interface Correction {
  action: CorrectionAction
  /** Multiplier to apply on top of the room's rate. 1 = untouched. */
  rateMultiplier: number
  /** Absolute media position to seek to. Only set when action is 'seek'. */
  seekTo: number | null
  reason: string
}

export interface DriftState {
  /** True while a nudge is in progress — drives the release hysteresis. */
  correcting: boolean
  /** Consecutive readings beyond SEEK_SEC. */
  overshoots: number
  /** Local clock of the last seek we issued. */
  lastSeekAt: number
  /** Media position of the last seek we issued, or null if we have not seeked. */
  lastSeekTarget: number | null
}

export function initialDriftState(): DriftState {
  return { correcting: false, overshoots: 0, lastSeekAt: 0, lastSeekTarget: null }
}

export interface DriftInput {
  /** Where this client actually is, in media seconds. */
  localTime: number
  /** Where the room says it should be, in media seconds. */
  targetTime: number
  /** Is the room rolling? A paused room needs position parity, not rate. */
  rolling: boolean
  /** Local clock, for the seek cooldown. */
  now: number
}

/**
 * Decide what to do about the current gap. Pure: the same inputs always give
 * the same answer, which is what makes this testable without a video element.
 *
 * Positive drift means we are ahead of the room and must slow down.
 */
export function decideCorrection(input: DriftInput, state: DriftState): {
  correction: Correction
  state: DriftState
} {
  const drift = input.localTime - input.targetTime
  const magnitude = Math.abs(drift)

  // While the room is paused everyone should be sitting on the exact same
  // frame. Rate is meaningless here, so parity is a position write — and a
  // seek while paused costs nothing, because there is no audio to interrupt.
  if (!input.rolling) {
    const hold = (reason: string): { correction: Correction; state: DriftState } => ({
      correction: { action: 'hold', rateMultiplier: 1, seekTo: null, reason },
      state: { ...state, correcting: false, overshoots: 0 }
    })

    if (magnitude <= DEADBAND_SEC) return hold('paused-aligned')

    // A paused target does not move, so a realign is a one-shot: ask once and
    // accept where the engine landed. Asking again every tick is the bug that
    // makes a room resync forever, because a seek can *never* close the last
    // few milliseconds — engines land on frame boundaries, and one frame of
    // 24fps content is 42ms, wider than the deadband. The retries are not
    // free either: each one flushes the buffer, which drops this client out of
    // the room's ready-gate and has everyone else stop and start around it.
    const sameTarget =
      state.lastSeekTarget !== null &&
      Math.abs(state.lastSeekTarget - input.targetTime) <= DEADBAND_SEC

    if (sameTarget) {
      // Small residue: this is frame quantisation, and it is as close as the
      // engine can get. Sitting one frame apart while paused is invisible.
      if (magnitude <= SEEK_SEC) return hold('paused-quantized')
      // A gap this big means the seek never took — the engine was loading, or
      // the position was not seekable yet. Retry, but no faster than a rolling
      // seek would, so a file that refuses to seek cannot thrash.
      if (input.now - state.lastSeekAt < SEEK_COOLDOWN_MS) return hold('paused-cooldown')
    }

    return {
      correction: {
        action: 'seek',
        rateMultiplier: 1,
        seekTo: input.targetTime,
        reason: 'paused-realign'
      },
      state: {
        ...state,
        correcting: false,
        overshoots: 0,
        lastSeekAt: input.now,
        lastSeekTarget: input.targetTime
      }
    }
  }

  // A gap this large will not close by nudging inside anyone's patience.
  // Require several consecutive readings first: one bad clock sample or a
  // single stale time report must never cause a visible jump.
  if (magnitude > SEEK_SEC) {
    const overshoots = state.overshoots + 1
    const cooled = input.now - state.lastSeekAt >= SEEK_COOLDOWN_MS
    if (overshoots >= SEEK_CONFIRMATIONS && cooled) {
      return {
        correction: {
          action: 'seek',
          rateMultiplier: 1,
          // Aim slightly ahead: by the time the seek lands the room has moved
          // on, and undershooting means immediately nudging forward again.
          seekTo: input.targetTime + 0.05,
          reason: 'far-out-of-sync'
        },
        state: {
          correcting: false,
          overshoots: 0,
          lastSeekAt: input.now,
          lastSeekTarget: input.targetTime + 0.05
        }
      }
    }
    // Not yet confirmed (or still cooling down) — pull hard with rate meanwhile.
    return {
      correction: {
        action: 'nudge',
        rateMultiplier: 1 - Math.sign(drift) * MAX_NUDGE,
        seekTo: null,
        reason: cooled ? 'confirming' : 'seek-cooldown'
      },
      state: { ...state, correcting: true, overshoots }
    }
  }

  // Hysteresis: having started to correct, do not stop at the deadband edge
  // or we oscillate in and out of it and the tempo audibly wobbles.
  const threshold = state.correcting ? RELEASE_SEC : DEADBAND_SEC
  if (magnitude <= threshold) {
    return {
      correction: { action: 'hold', rateMultiplier: 1, seekTo: null, reason: 'in-sync' },
      state: { ...state, correcting: false, overshoots: 0 }
    }
  }

  // Proportional correction, capped. Retire the gap over CONVERGE_SEC seconds:
  // 100ms of drift becomes a 2.5% rate change for about four seconds.
  const raw = -drift / CONVERGE_SEC
  const clamped = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw))
  return {
    correction: {
      action: 'nudge',
      rateMultiplier: 1 + clamped,
      seekTo: null,
      reason: drift > 0 ? 'ahead' : 'behind'
    },
    state: { ...state, correcting: true, overshoots: 0 }
  }
}

/** How the current gap should be described to a human. */
export function describeDrift(driftMs: number): 'locked' | 'close' | 'drifting' | 'off' {
  const m = Math.abs(driftMs)
  if (m <= DEADBAND_SEC * 1000) return 'locked'
  if (m <= 150) return 'close'
  if (m <= SEEK_SEC * 1000) return 'drifting'
  return 'off'
}
