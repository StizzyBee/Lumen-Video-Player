/** 3671 → "1:01:11"; 95 → "1:35" */
export function formatTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0
  const s = Math.floor(totalSec % 60)
  const m = Math.floor((totalSec / 60) % 60)
  const h = Math.floor(totalSec / 3600)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Remaining-time phrasing for cards: "42 min left" / "1 h 12 min left" */
export function formatRemaining(positionSec: number, durationSec: number): string {
  const left = Math.max(0, durationSec - positionSec)
  const min = Math.round(left / 60)
  if (min < 1) return 'Almost done'
  if (min < 60) return `${min} min left`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h} h ${m} min left` : `${h} h left`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10))
  const v = bytes / 2 ** (10 * i)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** 1920×1080 → "1080p", 3840×2160 → "4K", 7680×4320 → "8K" */
export function resolutionLabel(width?: number, height?: number): string | null {
  if (!width || !height) return null
  if (width >= 7000 || height >= 4000) return '8K'
  if (width >= 3500 || height >= 2000) return '4K'
  if (height >= 1380) return '1440p'
  if (height >= 1000) return '1080p'
  if (height >= 700) return '720p'
  if (height >= 460) return '480p'
  return `${height}p`
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function formatRate(rate: number): string {
  return `${parseFloat(rate.toFixed(2))}×`
}
