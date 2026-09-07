import type { WindowMaterial } from '@shared/types'

// Electron's native backdrop API requires Windows 11 22H2 (build 22621).
export const MIN_BACKGROUND_MATERIAL_BUILD = 22621

export type NativeWindowMaterial = 'none' | 'mica' | 'acrylic'

export function supportsWindowMaterial(platform: NodeJS.Platform, osRelease: string): boolean {
  if (platform !== 'win32') return false
  const build = Number.parseInt(osRelease.split('.')[2] ?? '0', 10)
  return Number.isFinite(build) && build >= MIN_BACKGROUND_MATERIAL_BUILD
}

export function resolveNativeWindowMaterial(
  material: WindowMaterial,
  platform: NodeJS.Platform,
  osRelease: string
): NativeWindowMaterial {
  if (material === 'solid' || !supportsWindowMaterial(platform, osRelease)) return 'none'
  return material
}
