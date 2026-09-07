import { describe, expect, it } from 'vitest'
import {
  MIN_BACKGROUND_MATERIAL_BUILD,
  resolveNativeWindowMaterial,
  supportsWindowMaterial
} from './window-material'

describe('Windows window materials', () => {
  it('requires Windows 11 22H2 or newer', () => {
    expect(supportsWindowMaterial('win32', `10.0.${MIN_BACKGROUND_MATERIAL_BUILD - 1}`)).toBe(false)
    expect(supportsWindowMaterial('win32', `10.0.${MIN_BACKGROUND_MATERIAL_BUILD}`)).toBe(true)
    expect(supportsWindowMaterial('linux', `10.0.${MIN_BACKGROUND_MATERIAL_BUILD}`)).toBe(false)
  })

  it('passes supported materials through to Electron', () => {
    expect(resolveNativeWindowMaterial('mica', 'win32', '10.0.26200')).toBe('mica')
    expect(resolveNativeWindowMaterial('acrylic', 'win32', '10.0.26200')).toBe('acrylic')
  })

  it('uses no native backdrop for solid or unsupported systems', () => {
    expect(resolveNativeWindowMaterial('solid', 'win32', '10.0.26200')).toBe('none')
    expect(resolveNativeWindowMaterial('mica', 'win32', '10.0.22000')).toBe('none')
  })
})
