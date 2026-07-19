// What to do when a video reaches its end. Shared by the built-in engine's
// `ended` event and the mpv engine's `eof-reached` event so loop / autoplay
// behave identically regardless of which engine is playing.

export type LoopMode = 'off' | 'one' | 'all'

export type EndAction =
  | 'loop-one' // restart the current video
  | 'next' // advance to the next queue item
  | 'loop-all' // wrap to the first queue item
  | 'stop' // hold on the last frame

export interface EndContext {
  loop: LoopMode
  /** Index of the current item within the queue (-1 if not queued) */
  queueIndex: number
  queueLength: number
  /** User's "play next automatically" preference */
  autoPlay: boolean
}

/**
 * Decide what should happen when playback hits the end. `loop: 'one'` is an
 * explicit user choice, so it wins even when autoplay is off. Otherwise we only
 * move on when autoplay is enabled: to the next item if there is one, else back
 * to the start of the queue when looping all.
 */
export function decideEndAction(ctx: EndContext): EndAction {
  if (ctx.loop === 'one') return 'loop-one'
  if (!ctx.autoPlay) return 'stop'
  if (ctx.queueIndex < ctx.queueLength - 1) return 'next'
  if (ctx.loop === 'all' && ctx.queueLength > 0) return 'loop-all'
  return 'stop'
}
