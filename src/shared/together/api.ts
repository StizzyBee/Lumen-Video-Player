// The renderer-facing slice of Together. Kept separate from relay/client code
// so the renderer never pulls a Node socket library into its bundle.

import { contentKey } from './protocol'
import type { ContentRef, DenyReason, RoomSnapshot } from './protocol'

export type { ContentRef, RoomSnapshot } from './protocol'

export type TogetherStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/** Everything main pushes to the renderer about a watch party. */
export type TogetherEvent =
  | { type: 'status'; status: TogetherStatus; message?: string }
  /**
   * A room snapshot, always paired with the clock estimate it should be read
   * against. Sending them together is deliberate: a snapshot interpreted with
   * a stale offset puts this watcher confidently on the wrong frame.
   */
  | {
      type: 'room'
      room: RoomSnapshot
      clockOffsetMs: number
      rttMs: number
      settled: boolean
    }
  | { type: 'clock'; clockOffsetMs: number; rttMs: number; settled: boolean }
  | { type: 'denied'; action: string; reason: DenyReason; until?: number; message: string }
  | { type: 'notice'; level: 'info' | 'ok' | 'warn'; title: string; desc?: string }
  | { type: 'error'; message: string }

/** Describe the file this watcher has open, for the same-content check. */
export function contentRefFor(title: string, durationSec: number): ContentRef {
  return { key: contentKey(title), title, durationSec }
}
