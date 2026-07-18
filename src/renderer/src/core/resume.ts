// Resume/continue-watching rules. Pure logic, unit-tested.
import type { LibraryItem } from '@shared/types'

/** Fraction watched, if known */
export function watchedFraction(item: Pick<LibraryItem, 'positionSec' | 'durationSec'>): number | null {
  if (item.positionSec === undefined || !item.durationSec) return null
  return Math.min(1, Math.max(0, item.positionSec / item.durationSec))
}

/** An item belongs in Continue Watching when meaningfully started but unfinished. */
export function isResumable(item: Pick<LibraryItem, 'positionSec' | 'durationSec'>): boolean {
  const f = watchedFraction(item)
  if (f === null) return false
  if ((item.positionSec ?? 0) < 20) return false
  return f > 0.005 && f < 0.96
}

/**
 * Position to persist after playback. Near the end (within `tailSec` or 96%)
 * the position resets so the next play starts over and the item leaves
 * Continue Watching.
 */
export function positionToSave(
  positionSec: number,
  durationSec: number | undefined,
  tailSec: number
): number | undefined {
  if (!durationSec || positionSec < 20) return undefined
  if (durationSec - positionSec <= tailSec) return undefined
  if (positionSec / durationSec >= 0.96) return undefined
  return Math.floor(positionSec)
}
