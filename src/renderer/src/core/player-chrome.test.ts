import { describe, expect, it } from 'vitest'
import { shouldShowPlayerChrome } from './player-chrome'

describe('player chrome visibility', () => {
  it('never hides controls in an ordinary window', () => {
    expect(shouldShowPlayerChrome(false, false, 'playing')).toBe(true)
  })

  it('may hide while playing in real fullscreen', () => {
    expect(shouldShowPlayerChrome(true, false, 'playing')).toBe(false)
  })

  it('stays visible when fullscreen playback is paused or ended', () => {
    expect(shouldShowPlayerChrome(true, false, 'paused')).toBe(true)
    expect(shouldShowPlayerChrome(true, false, 'ended')).toBe(true)
  })
})
