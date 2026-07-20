// Pure mapping from Lumen's video grade (HDR mode + color adjustments) to mpv
// properties. One source of truth used both for launch args and for live
// property updates over IPC, so what you set mid-playback matches a fresh
// launch exactly.
//
// HDR semantics with --vo=gpu-next:
//  • auto  — true HDR passthrough: --target-colorspace-hint switches the
//            swapchain to HDR when the display is in HDR mode; on SDR displays
//            mpv tone-maps with its default curve. This is "real HDR".
//  • vivid — HDR is tone-mapped through bt.2446a with a saturation/contrast
//            lift for a punchier grade.
//  • off   — force SDR: tone-map with hable to a 100-nit target.
import type { ColorAdjust, HdrMode } from '@shared/types'

export type MpvPropValue = string | number | boolean

/** Clamp a 1-centered multiplier to mpv's -100..100 percent scale. */
const pct = (v: number): number => Math.max(-100, Math.min(100, Math.round((v - 1) * 100)))

/**
 * mpv properties implementing a grade. All of these are runtime-settable, so
 * the same map drives launch args and live `set_property` updates.
 */
export function gradeProps(color: ColorAdjust, hdr: HdrMode): Record<string, MpvPropValue> {
  // Mirror the built-in engine's HDR nudges (video.ts buildFilter):
  // vivid ≈ ×1.04 contrast ×1.1 saturation, off ≈ ×0.96 / ×0.9.
  const hdrContrast = hdr === 'vivid' ? 4 : hdr === 'off' ? -4 : 0
  const hdrSaturation = hdr === 'vivid' ? 10 : hdr === 'off' ? -10 : 0
  return {
    'tone-mapping': hdr === 'vivid' ? 'bt.2446a' : hdr === 'off' ? 'hable' : 'auto',
    'target-colorspace-hint': hdr === 'off' ? 'no' : 'yes',
    'target-peak': hdr === 'off' ? 100 : 'auto',
    brightness: pct(color.brightness),
    contrast: Math.max(-100, Math.min(100, pct(color.contrast) + hdrContrast)),
    saturation: Math.max(-100, Math.min(100, pct(color.saturation) + hdrSaturation)),
    // Lumen's gamma slider raises the SVG exponent to darken (>1 = darker);
    // mpv's gamma property brightens for positive values — invert to match
    // (|| 0 normalizes the -0 that negating pct(1) produces).
    gamma: -pct(color.gamma) || 0
  }
}

/** The same grade as mpv command-line arguments (initial launch state). */
export function gradeArgs(color: ColorAdjust, hdr: HdrMode): string[] {
  return Object.entries(gradeProps(color, hdr)).map(([k, v]) => `--${k}=${v}`)
}
