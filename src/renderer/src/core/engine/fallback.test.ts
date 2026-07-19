import { describe, it, expect } from 'vitest'
import { fallbackForHtmlFailure } from './fallback'

describe('fallbackForHtmlFailure', () => {
  it('routes an undecodable mp4/mov to mpv when it is available', () => {
    expect(fallbackForHtmlFailure('mp4', 'decode', true)).toBe('mpv')
    expect(fallbackForHtmlFailure('mov', 'stall', true)).toBe('mpv')
    expect(fallbackForHtmlFailure('m4v', 'unsupported', true)).toBe('mpv')
    expect(fallbackForHtmlFailure('.mp4', 'stall', true)).toBe('mpv')
  })

  it('prompts to install mpv when it could rescue the file but is missing', () => {
    expect(fallbackForHtmlFailure('mp4', 'decode', false)).toBe('needmpv')
    expect(fallbackForHtmlFailure('mp4', 'stall', false)).toBe('needmpv')
  })

  it('does not hijack non-recoverable errors (e.g. a genuinely missing file)', () => {
    expect(fallbackForHtmlFailure('mp4', 'network', true)).toBe('none')
    expect(fallbackForHtmlFailure('mp4', null, true)).toBe('none')
    expect(fallbackForHtmlFailure('mp4', undefined, true)).toBe('none')
  })

  it('ignores extensions that never use the HTML engine (routed to mpv up front)', () => {
    // mkv/avi decode errors are surfaced by the mpv path, not this one
    expect(fallbackForHtmlFailure('mkv', 'decode', true)).toBe('none')
    expect(fallbackForHtmlFailure('avi', 'stall', true)).toBe('none')
  })
})
