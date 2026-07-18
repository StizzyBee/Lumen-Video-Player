// Pure video-adjustment logic: color/HDR filter strings, resolution options,
// and render-downscale geometry. Kept framework-free and unit-tested; the
// engine just applies what these return.
import type { ColorAdjust, HdrMode, ResolutionCap } from '@shared/types'

export type { ColorAdjust, HdrMode, ResolutionCap } from '@shared/types'

export const DEFAULT_COLOR: ColorAdjust = { brightness: 1, contrast: 1, saturation: 1, gamma: 1 }

const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Compose the CSS `filter` value. Gamma (when non-neutral) is applied via a
 * referenced SVG filter; brightness/contrast/saturation are native functions.
 * HDR modes nudge saturation/contrast to grade toward vivid or a tamer SDR look.
 */
export function buildFilter(color: ColorAdjust, hdr: HdrMode, gammaFilterId: string): string {
  const parts: string[] = []
  if (r2(color.gamma) !== 1) parts.push(`url(#${gammaFilterId})`)
  if (r2(color.brightness) !== 1) parts.push(`brightness(${r2(color.brightness)})`)

  let contrast = color.contrast
  let saturation = color.saturation
  if (hdr === 'vivid') {
    contrast *= 1.04
    saturation *= 1.1
  } else if (hdr === 'off') {
    contrast *= 0.96
    saturation *= 0.9
  }
  if (r2(contrast) !== 1) parts.push(`contrast(${r2(contrast)})`)
  if (r2(saturation) !== 1) parts.push(`saturate(${r2(saturation)})`)

  return parts.length ? parts.join(' ') : 'none'
}

export const RES_TIERS: Exclude<ResolutionCap, 'auto'>[] = [2160, 1440, 1080, 720, 480]

export interface ResolutionOption {
  value: ResolutionCap
  label: string
  /** the tier closest to (and not above) the source — the file's native quality */
  isSource?: boolean
  /** selecting this would render above the source's detail */
  upscale?: boolean
}

/** Nearest standard tier at or below the source height. */
export function sourceTier(sourceHeight?: number): Exclude<ResolutionCap, 'auto'> | null {
  if (!sourceHeight) return null
  for (const t of RES_TIERS) if (sourceHeight >= t - 40) return t
  return 480
}

/**
 * Resolution options offered for a given source. Downscale tiers (≤ source)
 * are the meaningful ones for local files; higher tiers are marked as upscales.
 */
export function availableResolutions(sourceHeight?: number): ResolutionOption[] {
  const native = sourceTier(sourceHeight)
  const opts: ResolutionOption[] = [{ value: 'auto', label: native ? `Auto · ${native}p source` : 'Auto' }]
  for (const t of RES_TIERS) {
    if (!native) {
      opts.push({ value: t, label: `${t}p` })
    } else if (t <= native) {
      opts.push({ value: t, label: `${t}p`, isSource: t === native })
    }
  }
  return opts
}

export interface RenderPlan {
  /** null → let the video fill its host normally (no downscale) */
  raster: { w: number; h: number; left: number; top: number; scale: number } | null
}

/** Contain-fit box for a source inside a host. */
function containBox(hostW: number, hostH: number, vW: number, vH: number): { w: number; h: number; left: number; top: number } {
  const hostAspect = hostW / hostH
  const vidAspect = vW / vH
  let w: number, h: number
  if (hostAspect > vidAspect) {
    h = hostH
    w = h * vidAspect
  } else {
    w = hostW
    h = w / vidAspect
  }
  return { w, h, left: (hostW - w) / 2, top: (hostH - h) / 2 }
}

/**
 * Plan a genuine render downscale: rasterize the frame at `cap` height then
 * GPU-scale it up to the contain box. Reduces composited pixels for real —
 * used when the source is taller than the cap.
 */
export function planRender(
  hostW: number,
  hostH: number,
  vW: number,
  vH: number,
  cap: ResolutionCap
): RenderPlan {
  if (cap === 'auto' || !vW || !vH || vH <= cap || hostW <= 0 || hostH <= 0) return { raster: null }
  const box = containBox(hostW, hostH, vW, vH)
  const rasterH = cap
  const rasterW = Math.round(vW * (cap / vH))
  const scale = box.h / rasterH
  return { raster: { w: rasterW, h: rasterH, left: box.left, top: box.top, scale } }
}
