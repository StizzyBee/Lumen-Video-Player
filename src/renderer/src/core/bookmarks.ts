// Bookmark list operations. Bookmarks are seconds offsets stored on the
// library item; toggling near an existing bookmark removes it instead of
// stacking duplicates. Pure logic, unit-tested.

export const BOOKMARK_MERGE_WINDOW_SEC = 3

/** Add t, or remove the nearest existing bookmark within the merge window. */
export function toggleBookmark(
  list: number[] | undefined,
  t: number,
  windowSec = BOOKMARK_MERGE_WINDOW_SEC
): { list: number[]; added: boolean } {
  const current = list ?? []
  let nearest = -1
  let nearestDist = Infinity
  for (let i = 0; i < current.length; i++) {
    const d = Math.abs(current[i] - t)
    if (d < nearestDist) {
      nearestDist = d
      nearest = i
    }
  }
  if (nearest >= 0 && nearestDist <= windowSec) {
    return { list: current.filter((_, i) => i !== nearest), added: false }
  }
  const rounded = Math.round(t * 10) / 10
  return { list: [...current, rounded].sort((a, b) => a - b), added: true }
}

export function removeBookmark(list: number[] | undefined, t: number): number[] {
  return (list ?? []).filter((b) => b !== t)
}
