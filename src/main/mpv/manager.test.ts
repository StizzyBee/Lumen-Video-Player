import { describe, expect, it } from 'vitest'
import { embeddedWindowArgs } from './manager'

describe('embeddedWindowArgs', () => {
  it('creates only a hidden, borderless render layer for Lumen to adopt', () => {
    const args = embeddedWindowArgs()

    expect(args).toContain('--force-window=yes')
    expect(args).toContain('--no-border')
    expect(args).toContain('--show-in-taskbar=no')
    expect(args).toContain('--window-minimized=yes')
    expect(args).toContain('--auto-window-resize=no')
    expect(args).toContain('--no-osc')
    expect(args.some((arg) => arg.startsWith('--wid='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--title='))).toBe(false)
  })
})
