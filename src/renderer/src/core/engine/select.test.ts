import { describe, expect, it } from 'vitest'
import { HTML5_VIDEO_EXTENSIONS, MPV_VIDEO_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/types'
import { selectEngine, HTML5_CONTAINERS } from './select'

describe('selectEngine', () => {
  it('uses the built-in engine for its native containers', () => {
    for (const ext of HTML5_VIDEO_EXTENSIONS) {
      expect(selectEngine(ext, { mpvAvailable: false })).toBe('html5')
      expect(selectEngine(ext, { mpvAvailable: true })).toBe('html5')
    }
  })
  it('routes every sidecar format to mpv when available', () => {
    for (const ext of MPV_VIDEO_EXTENSIONS) {
      expect(selectEngine(ext, { mpvAvailable: true })).toBe('mpv')
      expect(selectEngine(ext, { mpvAvailable: false })).toBe('none')
    }
  })
  it('reports none for mpv-only files when mpv is missing', () => {
    expect(selectEngine('mkv', { mpvAvailable: false })).toBe('none')
    expect(selectEngine('avi', { mpvAvailable: false })).toBe('none')
    expect(selectEngine('m2ts', { mpvAvailable: false })).toBe('none')
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
    expect(HTML5_CONTAINERS.has('m2ts')).toBe(false)
  })
  it('keeps the shared extension registry unique', () => {
    expect(new Set(VIDEO_EXTENSIONS).size).toBe(VIDEO_EXTENSIONS.length)
  })
})
