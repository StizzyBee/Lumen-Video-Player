import { describe, expect, it } from 'vitest'
import { embeddedWindowArgs } from './manager'

describe('embeddedWindowArgs', () => {
  it('always targets Lumen and disables a standalone mpv window', () => {
    const args = embeddedWindowArgs(12345)

    expect(args).toContain('--wid=12345')
    expect(args).toContain('--force-window=no')
    expect(args).toContain('--no-osc')
    expect(args).not.toContain('--force-window=yes')
    expect(args.some((arg) => arg.startsWith('--title='))).toBe(false)
  })

  it('refuses to launch without a valid embedded-window handle', () => {
    expect(() => embeddedWindowArgs(0)).toThrow('mpv-embed-required')
    expect(() => embeddedWindowArgs(Number.NaN)).toThrow('mpv-embed-required')
  })
})
