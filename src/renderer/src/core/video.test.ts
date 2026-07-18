import { describe, expect, it } from 'vitest'
import { buildFilter, availableResolutions, sourceTier, planRender, DEFAULT_COLOR } from './video'

describe('buildFilter', () => {
  it('returns none for neutral color + auto hdr', () => {
    expect(buildFilter(DEFAULT_COLOR, 'auto', 'g')).toBe('none')
  })
  it('emits brightness/contrast/saturate for adjusted color', () => {
    const f = buildFilter({ brightness: 1.2, contrast: 0.9, saturation: 1.3, gamma: 1 }, 'auto', 'g')
    expect(f).toContain('brightness(1.2)')
    expect(f).toContain('contrast(0.9)')
    expect(f).toContain('saturate(1.3)')
    expect(f).not.toContain('url(')
  })
  it('references the gamma filter only when gamma is non-neutral', () => {
    expect(buildFilter({ ...DEFAULT_COLOR, gamma: 1.4 }, 'auto', 'gmm')).toContain('url(#gmm)')
  })
  it('hdr vivid boosts saturation/contrast; off tones them down', () => {
    const vivid = buildFilter(DEFAULT_COLOR, 'vivid', 'g')
    const off = buildFilter(DEFAULT_COLOR, 'off', 'g')
    expect(vivid).toContain('saturate(1.1)')
    expect(off).toContain('saturate(0.9)')
    expect(vivid).toContain('contrast(1.04)')
  })
})

describe('sourceTier / availableResolutions', () => {
  it('maps source height to the nearest tier at or below', () => {
    expect(sourceTier(2160)).toBe(2160)
    expect(sourceTier(1440)).toBe(1440)
    expect(sourceTier(1080)).toBe(1080)
    expect(sourceTier(800)).toBe(720)
    expect(sourceTier(undefined)).toBeNull()
  })
  it('offers auto + only downscale tiers for a 1440p source, marking the source', () => {
    const opts = availableResolutions(1440)
    const values = opts.map((o) => o.value)
    expect(values).toEqual(['auto', 1440, 1080, 720, 480])
    expect(opts.find((o) => o.value === 1440)?.isSource).toBe(true)
    expect(opts.find((o) => o.value === 2160)).toBeUndefined()
  })
  it('lets you swap 1440p and 1080p on a 4K source', () => {
    const values = availableResolutions(2160).map((o) => o.value)
    expect(values).toContain(1440)
    expect(values).toContain(1080)
  })
  it('offers all tiers when the source is unknown', () => {
    expect(availableResolutions(undefined).map((o) => o.value)).toEqual(['auto', 2160, 1440, 1080, 720, 480])
  })
})

describe('planRender', () => {
  it('no downscale when cap is auto or source is at/below the cap', () => {
    expect(planRender(1920, 1080, 1920, 1080, 'auto').raster).toBeNull()
    expect(planRender(1920, 1080, 1920, 1080, 1080).raster).toBeNull()
    expect(planRender(1920, 1080, 1280, 720, 1080).raster).toBeNull()
  })
  it('rasterizes at the cap height and scales to the contain box for a taller source', () => {
    // 4K source in a 1920x1080 host, capped at 1080p
    const plan = planRender(1920, 1080, 3840, 2160, 1080)
    expect(plan.raster).not.toBeNull()
    expect(plan.raster!.h).toBe(1080)
    expect(plan.raster!.w).toBe(1920)
    // contain box fills the 16:9 host exactly → scale 1080/1080 = 1
    expect(plan.raster!.scale).toBeCloseTo(1, 5)
  })
  it('centres the raster in a wider host', () => {
    // 16:9 source in a 2000x1000 host (2:1), capped at 720p
    const plan = planRender(2000, 1000, 1920, 1080, 720)
    expect(plan.raster).not.toBeNull()
    // contain box height = 1000, width = 1000*16/9 ≈ 1778 → left offset > 0
    expect(plan.raster!.left).toBeGreaterThan(0)
    expect(plan.raster!.top).toBeCloseTo(0, 1)
  })
})
