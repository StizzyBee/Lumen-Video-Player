// Lightweight subsequence fuzzy matcher (VS Code-style) used by the command
// palette and library search. Returns a score (higher = better) or null.

export interface FuzzyResult {
  score: number
  /** Indexes of matched characters in the target (for highlighting) */
  positions: number[]
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return { score: 0, positions: [] }
  if (q.length > t.length) return null

  // Fast path: substring hit scores high, earlier + tighter is better
  const sub = t.indexOf(q)
  if (sub >= 0) {
    const positions = Array.from({ length: q.length }, (_, i) => sub + i)
    let score = 100 - Math.min(40, sub) + (sub === 0 || isBoundary(target, sub) ? 30 : 0)
    score += Math.max(0, 20 - (t.length - q.length) / 4)
    return { score, positions }
  }

  // Subsequence walk with boundary/consecutive bonuses
  const positions: number[] = []
  let score = 0
  let ti = 0
  let streak = 0
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    let found = -1
    while (ti < t.length) {
      if (t[ti] === c) {
        found = ti
        break
      }
      ti++
    }
    if (found === -1) return null
    const prev = positions[positions.length - 1]
    if (prev !== undefined && found === prev + 1) {
      streak++
      score += 6 + streak * 2
    } else {
      streak = 0
      score += 1
    }
    if (isBoundary(target, found)) score += 12
    positions.push(found)
    ti = found + 1
  }
  score -= Math.floor((positions[positions.length - 1] - positions[0]) / 6)
  score -= Math.floor(t.length / 24)
  return { score, positions }
}

function isBoundary(s: string, i: number): boolean {
  if (i === 0) return true
  const prev = s[i - 1]
  if (' .-_/\\([{'.includes(prev)) return true
  // camelCase boundary
  return prev === prev.toLowerCase() && s[i] === s[i].toUpperCase() && /[a-z]/i.test(s[i])
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string | string[],
  limit = 50
): Array<{ item: T; score: number }> {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0 }))
  const out: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const keys = key(item)
    const targets = Array.isArray(keys) ? keys : [keys]
    let best: number | null = null
    for (let i = 0; i < targets.length; i++) {
      const r = fuzzyMatch(query, targets[i])
      if (r) {
        // secondary keys (filename, folder, tags) are slightly discounted
        const s = r.score - i * 4
        if (best === null || s > best) best = s
      }
    }
    if (best !== null) out.push({ item, score: best })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
