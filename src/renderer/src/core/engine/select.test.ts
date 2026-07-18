import { describe, expect, it } from 'vitest'
import { selectEngine, HTML5_CONTAINERS } from './select'

describe('selectEngine', () => {
  it('uses the built-in engine for its native containers', () => {
    for (const ext of ['mp4', 'mov', 'm4v', 'webm']) {
      expect(selectEngine(ext, { mpvAvailable: false })).toBe('html5')
      expect(selectEngine(ext, { mpvAvailable: true })).toBe('html5')
    }
  })
  it('routes MKV/AVI/etc. to mpv when available', () => {
    for (const ext of ['mkv', 'avi', 'wmv', 'flv', 'mpg', 'ts']) {
      expect(selectEngine(ext, { mpvAvailable: true })).toBe('mpv')
    }
  })
  it('reports none for mpv-only files when mpv is missing', () => {
    expect(selectEngine('mkv', { mpvAvailable: false })).toBe('none')
    expect(selectEngine('avi', { mpvAvailable: false })).toBe('none')
  })
  it('honors preferMpv only when mpv is available', () => {
    expect(selectEngine('mp4', { mpvAvailable: true, preferMpv: true })).toBe('mpv')
    expect(selectEngine('mp4', { mpvAvailable: false, preferMpv: true })).toBe('html5')
  })
  it('is case- and dot-insensitive', () => {
    expect(selectEngine('.MKV', { mpvAvailable: true })).toBe('mpv')
    expect(selectEngine('MP4', { mpvAvailable: false })).toBe('html5')
  })
  it('HTML5_CONTAINERS excludes mkv', () => {
    expect(HTML5_CONTAINERS.has('mkv')).toBe(false)
  })
})
