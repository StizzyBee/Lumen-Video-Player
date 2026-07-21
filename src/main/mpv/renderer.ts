/**
 * Virtual display adapters commonly accept a D3D11 swapchain while never
 * presenting it into a child HWND. mpv then reports healthy video playback,
 * but Electron shows a black embedded surface. OpenGL avoids the virtual D3D
 * swapchain on those adapters while preserving mpv's shader-based controls.
 */
export function needsCompatibilityRenderer(gpuInfo: unknown, featureStatus?: unknown): boolean {
  const signature = JSON.stringify({ gpuInfo, featureStatus }).toLowerCase()

  return [
    'vmware',
    'virtualbox',
    'microsoft basic render',
    'parallels display'
  ].some((marker) => signature.includes(marker)) ||
    // PCI vendor IDs: VMware (15ad), VirtualBox (80ee), Microsoft (1414).
    /"vendorid":(?:5549|33006|5140)(?:,|})/.test(signature)
}

export function videoOutputArgs(compatibilityMode: boolean): string[] {
  if (compatibilityMode) {
    return [
      '--vo=gpu',
      '--gpu-api=opengl',
      '--gpu-context=win',
      // Virtual adapters expose D3D11 decode APIs that fail after allocation.
      // Software H.264/HEVC decode is more reliable and avoids repeated resets.
      '--hwdec=no'
    ]
  }

  return [
    '--vo=gpu-next',
    // Flip-model swapchains render black when mpv targets a child HWND.
    '--d3d11-flip=no'
  ]
}
