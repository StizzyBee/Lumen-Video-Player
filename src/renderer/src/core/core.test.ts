import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzyFilter } from './utils/fuzzy'
import { formatTime, formatBytes, resolutionLabel, formatRemaining } from './utils/format'
import { isResumable, positionToSave, watchedFraction } from './resume'
import { bindingFromEvent, resolveKeymap, findConflicts, DEFAULT_KEYMAP } from './shortcuts'
import { mergeSettings, DEFAULT_SETTINGS } from '@shared/types'

describe('fuzzy', () => {
  it('ranks substring and boundary matches above scattered ones', () => {
    const a = fuzzyMatch('big', 'Big Buck Bunny')!
    const b = fuzzyMatch('big', 'Bridge of gulls')!
    expect(a.score).toBeGreaterThan(b.score)
  })
  it('returns null when characters are missing', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
  })
  it('filters across multiple keys with primary-key preference', () => {
    const items = [
      { title: 'Sunset', file: 'IMG_0001.mp4' },
      { title: 'Beach day', file: 'sunset_raw.mp4' }
    ]
    const res = fuzzyFilter('sunset', items, (i) => [i.title, i.file])
    expect(res[0].item.title).toBe('Sunset')
    expect(res).toHaveLength(2)
  })
})

describe('format', () => {
  it('formats times', () => {
    expect(formatTime(95)).toBe('1:35')
    expect(formatTime(3671)).toBe('1:01:11')
    expect(formatTime(NaN)).toBe('0:00')
  })
  it('formats bytes and resolutions', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(resolutionLabel(3840, 2160)).toBe('4K')
    expect(resolutionLabel(1920, 1080)).toBe('1080p')
    expect(resolutionLabel(undefined, undefined)).toBeNull()
  })
  it('phrases remaining time', () => {
    expect(formatRemaining(600, 3600)).toBe('50 min left')
    expect(formatRemaining(0, 5400)).toBe('1 h 30 min left')
  })
})

describe('resume rules', () => {
  it('resumable only in the meaningful middle', () => {
    expect(isResumable({ positionSec: 300, durationSec: 3600 })).toBe(true)
    expect(isResumable({ positionSec: 5, durationSec: 3600 })).toBe(false)
    expect(isResumable({ positionSec: 3590, durationSec: 3600 })).toBe(false)
    expect(isResumable({ positionSec: undefined, durationSec: 3600 })).toBe(false)
  })
  it('drops the saved position near the end', () => {
    expect(positionToSave(3550, 3600, 90)).toBeUndefined()
    expect(positionToSave(1800, 3600, 90)).toBe(1800)
    expect(positionToSave(10, 3600, 90)).toBeUndefined()
  })
  it('computes watched fraction defensively', () => {
    expect(watchedFraction({ positionSec: 50, durationSec: 100 })).toBe(0.5)
    expect(watchedFraction({ positionSec: 50, durationSec: undefined })).toBeNull()
  })
})

describe('shortcuts', () => {
  it('normalizes keyboard events into bindings', () => {
    expect(bindingFromEvent({ key: ' ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe('Space')
    expect(bindingFromEvent({ key: 's', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe('Ctrl+Shift+S')
    expect(bindingFromEvent({ key: 'ArrowLeft', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe('Left')
    expect(bindingFromEvent({ key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBeNull()
  })
  it('resolves defaults and user overrides', () => {
    const map = resolveKeymap({})
    expect(map.get('Space')).toBe('playback.toggle')
    const custom = resolveKeymap({ 'playback.toggle': 'Enter' })
    expect(custom.get('Enter')).toBe('playback.toggle')
    expect(custom.get('Space')).toBeUndefined()
  })
  it('an override steals a binding from its default owner', () => {
    const map = resolveKeymap({ 'playback.mute': 'F' })
    expect(map.get('F')).toBe('playback.mute')
    // fullscreen lost its default key
    expect([...map.values()].filter((c) => c === 'playback.fullscreen')).toHaveLength(0)
  })
  it('detects conflicts', () => {
    expect(findConflicts('F', 'playback.mute', {})).toContain('playback.fullscreen')
    expect(findConflicts(DEFAULT_KEYMAP['playback.toggle'], 'playback.toggle', {})).toHaveLength(0)
  })
})

describe('settings migration', () => {
  it('fills missing fields from defaults and keeps user values', () => {
    const merged = mergeSettings({ theme: { accent: '#ff0000' }, audio: { volume: 0.3 } })
    expect(merged.theme.accent).toBe('#ff0000')
    expect(merged.theme.mode).toBe(DEFAULT_SETTINGS.theme.mode)
    expect(merged.audio.volume).toBe(0.3)
    expect(merged.playback.rememberPosition).toBe(true)
  })
  it('survives null/garbage input', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })
  it('preserves custom shortcut maps wholesale', () => {
    const merged = mergeSettings({ shortcuts: { 'playback.toggle': 'Enter' } })
    expect(merged.shortcuts['playback.toggle']).toBe('Enter')
  })
})
