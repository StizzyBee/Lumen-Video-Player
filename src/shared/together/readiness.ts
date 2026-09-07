// "Can this watcher play the next frame right now?"
//
// The room's ready-gate is built on this answer, which makes it easy to get
// catastrophically wrong. The rule that matters:
//
//   Readiness must never depend on whether the room has paused us.
//
// An earlier version treated a paused engine as ready, to avoid a client that
// could never report ready holding the gate shut forever. That created a loop
// with no exit: the room pauses you because you are not ready, pausing makes
// you "ready", being ready makes the room resume, resuming makes you not ready
// — the video pauses and unpauses several times a second, forever.
//
// So readiness is a statement about *buffered data*, which pausing does not
// change. The deadlock it was guarding against is handled by distinguishing
// "no data" from "no information": an engine that cannot report buffer ranges
// at all (mpv) is trusted, rather than assumed to be starving.

/** Below this many seconds ahead, a playing client is about to stall. */
export const READY_LOW_SEC = 0.4
/**
 * Recovering takes more than falling over. Without this gap a client sitting
 * near the threshold flaps between ready and not, and drags the whole room's
 * playback with it once per report.
 */
export const READY_HIGH_SEC = 2

export interface ReadinessInput {
  hasItem: boolean
  /** Engine status. Only the stalled states matter; play/pause must not. */
  status: string
  /**
   * Seconds of media buffered ahead of the playhead, or null when the engine
   * has no opinion. Null is "unknown", never "empty".
   */
  bufferedAhead: number | null
  /** The previous answer — this is a Schmitt trigger, not a threshold. */
  wasReady: boolean
}

export function decideReadiness(input: ReadinessInput): boolean {
  if (!input.hasItem) return false

  // These are the engine's own admissions that it cannot show a frame.
  // Note that 'paused' is deliberately absent: a paused engine with data is
  // perfectly ready, and treating it as ready *because* it is paused is the
  // bug this module exists to prevent.
  if (input.status === 'loading' || input.status === 'buffering' || input.status === 'error') {
    return false
  }

  // No buffer information at all (mpv renders out of process and reports
  // stalls through status instead). Trust the status we already checked.
  if (input.bufferedAhead === null) return true

  return input.wasReady ? input.bufferedAhead >= READY_LOW_SEC : input.bufferedAhead >= READY_HIGH_SEC
}
