import { describe, expect, it } from 'vitest'
import { needsCompatibilityRenderer, videoOutputArgs } from './renderer'

describe('needsCompatibilityRenderer', () => {
  it('selects the child-window-safe renderer for VMware', () => {
    expect(needsCompatibilityRenderer({ gpuDevice: [{ vendorId: 0x15ad }] })).toBe(true)
    expect(needsCompatibilityRenderer({ gpuDevice: [{ driverVendor: 'VMware, Inc.' }] })).toBe(true)
  })

  it('keeps gpu-next for physical graphics adapters', () => {
    expect(needsCompatibilityRenderer({ gpuDevice: [{ vendorId: 0x10de, driverVendor: 'NVIDIA' }] })).toBe(false)
  })
})

describe('videoOutputArgs', () => {
  it('uses OpenGL plus software decode in compatibility mode', () => {
    expect(videoOutputArgs(true)).toEqual([
      '--vo=gpu',
      '--gpu-api=opengl',
      '--gpu-context=win',
      '--hwdec=no'
    ])
  })

  it('uses the HDR-capable renderer on normal hardware', () => {
    expect(videoOutputArgs(false)).toEqual(['--vo=gpu-next', '--d3d11-flip=no'])
  })
})
