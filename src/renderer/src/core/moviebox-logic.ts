import type { MovieBoxPlaybackCommand } from '@shared/moviebox'

export function authorizedMovieBoxUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function numberValue(values: Record<string, unknown>, ...names: string[]): number | null {
  for (const name of names) {
    const value = values[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/** Translate transport messages emitted by MovieBox's active player session. */
export function movieBoxCommandEffect(command: MovieBoxPlaybackCommand):
  | { type: 'play' | 'pause' | 'close' }
  | { type: 'seek' | 'rate'; value: number }
  | null {
  const action = command.Action.trim().toLowerCase()
  if (action === 'play' || action === 'resume') return { type: 'play' }
  if (action === 'pause') return { type: 'pause' }
  if (action === 'stop' || action === 'close') return { type: 'close' }
  if (action.includes('seek') || action === 'timechanged') {
    const value = numberValue(command.Values, 'Seconds', 'seconds', 'CurTime', 'Time', 'Position')
    return value == null ? null : { type: 'seek', value: Math.max(0, value) }
  }
  if (action.includes('rate') || action === 'speed') {
    const value = numberValue(command.Values, 'Rate', 'rate', 'Speed', 'Value')
    return value == null ? null : { type: 'rate', value: Math.max(0.06, Math.min(16, value)) }
  }
  return null
}
