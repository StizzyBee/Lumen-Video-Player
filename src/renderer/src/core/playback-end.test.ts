import { describe, it, expect } from 'vitest'
import { decideEndAction } from './playback-end'

describe('decideEndAction', () => {
  it('loops the single video when loop=one, regardless of autoplay', () => {
    expect(decideEndAction({ loop: 'one', queueIndex: 0, queueLength: 3, autoPlay: false })).toBe('loop-one')
    expect(decideEndAction({ loop: 'one', queueIndex: 2, queueLength: 3, autoPlay: true })).toBe('loop-one')
  })

  it('stops at the end when autoplay is off', () => {
    expect(decideEndAction({ loop: 'off', queueIndex: 0, queueLength: 3, autoPlay: false })).toBe('stop')
    expect(decideEndAction({ loop: 'all', queueIndex: 2, queueLength: 3, autoPlay: false })).toBe('stop')
  })

  it('advances to the next item when one exists and autoplay is on', () => {
    expect(decideEndAction({ loop: 'off', queueIndex: 0, queueLength: 3, autoPlay: true })).toBe('next')
    expect(decideEndAction({ loop: 'all', queueIndex: 1, queueLength: 3, autoPlay: true })).toBe('next')
  })

  it('wraps to the first item at the end of the queue only when loop=all', () => {
    expect(decideEndAction({ loop: 'all', queueIndex: 2, queueLength: 3, autoPlay: true })).toBe('loop-all')
    expect(decideEndAction({ loop: 'off', queueIndex: 2, queueLength: 3, autoPlay: true })).toBe('stop')
  })

  it('stops a lone non-looping video', () => {
    expect(decideEndAction({ loop: 'off', queueIndex: 0, queueLength: 1, autoPlay: true })).toBe('stop')
    expect(decideEndAction({ loop: 'all', queueIndex: 0, queueLength: 1, autoPlay: true })).toBe('loop-all')
  })

  it('treats an unqueued item (index -1) sensibly', () => {
    // Single loose file: no next, so stop unless explicitly looping
    expect(decideEndAction({ loop: 'off', queueIndex: -1, queueLength: 0, autoPlay: true })).toBe('stop')
    expect(decideEndAction({ loop: 'one', queueIndex: -1, queueLength: 0, autoPlay: true })).toBe('loop-one')
  })
})
