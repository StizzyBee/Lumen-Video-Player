import type { PlaybackStatus } from './engine/types'

/** Windowed playback always keeps controls; only true fullscreen may hide. */
export function shouldShowPlayerChrome(
  fullscreen: boolean,
  recentlyActive: boolean,
  status: PlaybackStatus
): boolean {
  return !fullscreen || recentlyActive || status !== 'playing'
}
