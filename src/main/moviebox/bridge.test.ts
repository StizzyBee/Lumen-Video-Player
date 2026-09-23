import { describe, expect, it } from 'vitest'
import { movieBoxLaunchArgs, normalizeMovieBoxState } from './bridge'

describe('movieBoxLaunchArgs', () => {
  it('accepts a local pipe token and strips line breaks from the user agent', () => {
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', 'MovieBox-123_ab', '--user-agent', 'Agent\r\nInjected'])).toEqual({
      pipeName: 'MovieBox-123_ab',
      userAgent: 'AgentInjected'
    })
  })

  it('rejects paths and remote pipe names', () => {
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', '\\\\server\\pipe\\name'])).toBeNull()
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', '..\\name'])).toBeNull()
  })
})

describe('normalizeMovieBoxState', () => {
  it('bounds numeric values sent to the bridge', () => {
    expect(normalizeMovieBoxState({
      revision: 2.9,
      position: -10,
      duration: Number.NaN,
      playing: true,
      ready: true,
      volume: 140,
      muted: false
    })).toEqual({
      revision: 2,
      position: 0,
      duration: 0,
      playing: true,
      ready: true,
      volume: 100,
      muted: false
    })
  })
})
