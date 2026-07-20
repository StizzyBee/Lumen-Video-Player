import { describe, expect, it } from 'vitest'
import { gradeProps, gradeArgs } from './grade'

const NEUTRAL = { brightness: 1, contrast: 1, saturation: 1, gamma: 1 }

describe('gradeProps', () => {
  it('auto = true HDR passthrough with neutral color', () => {
    const p = gradeProps(NEUTRAL, 'auto')
    expect(p['target-colorspace-hint']).toBe('yes')
    expect(p['tone-mapping']).toBe('auto')
    expect(p['target-peak']).toBe('auto')
    expect(p.brightness).toBe(0)
    expect(p.contrast).toBe(0)
    expect(p.saturation).toBe(0)
    expect(p.gamma).toBe(0)
  })

  it('off = forced SDR tone-mapping to 100 nits', () => {
    const p = gradeProps(NEUTRAL, 'off')
    expect(p['target-colorspace-hint']).toBe('no')
    expect(p['tone-mapping']).toBe('hable')
    expect(p['target-peak']).toBe(100)
    expect(p.saturation).toBe(-10)
    expect(p.contrast).toBe(-4)
  })

  it('vivid = bt.2446a with saturation/contrast lift', () => {
    const p = gradeProps(NEUTRAL, 'vivid')
    expect(p['tone-mapping']).toBe('bt.2446a')
    expect(p.saturation).toBe(10)
    expect(p.contrast).toBe(4)
  })

  it('maps 1-centered multipliers onto mpv percent scale', () => {
    const p = gradeProps({ brightness: 1.25, contrast: 0.8, saturation: 1.5, gamma: 1.2 }, 'auto')
    expect(p.brightness).toBe(25)
    expect(p.contrast).toBe(-20)
    expect(p.saturation).toBe(50)
    expect(p.gamma).toBe(-20) // Lumen gamma >1 darkens; mpv positive brightens
  })

  it('clamps combined adjustments to mpv range', () => {
    const p = gradeProps({ brightness: 5, contrast: 5, saturation: 5, gamma: 5 }, 'vivid')
    expect(p.brightness).toBe(100)
    expect(p.contrast).toBe(100)
    expect(p.saturation).toBe(100)
    expect(p.gamma).toBe(-100)
  })
})

describe('gradeArgs', () => {
  it('serializes the same props as CLI flags', () => {
    const args = gradeArgs(NEUTRAL, 'auto')
    expect(args).toContain('--target-colorspace-hint=yes')
    expect(args).toContain('--tone-mapping=auto')
    expect(args).toContain('--brightness=0')
  })
})
