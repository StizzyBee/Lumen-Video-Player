/**
 * Virtual display adapters commonly accept a D3D11 swapchain while never
 * presenting it into a child HWND. Lumen avoids that nesting entirely, and
 * uses MPV's mature Direct3D 9 output on virtual adapters for the broadest
 * working software-rendered path.
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
      '--vo=direct3d',
      // Virtual adapters expose hardware decode APIs that fail after allocation.
      '--hwdec=no'
    ]
  }

  return [
    '--vo=gpu-next',
    // Flip-model swapchains render black when mpv targets a child HWND.
    '--d3d11-flip=no'
  ]
}
