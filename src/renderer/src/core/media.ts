// Media-element source helper.
//
// Canvas frame capture (screenshots, thumbnails, hover previews) needs the
// media fetched in CORS mode (`crossOrigin = 'anonymous'`) or the canvas is
// tainted. Our lumen:// protocol grants CORS, and blob/same-origin sources
// are safe — but arbitrary remote URLs (browser-preview sample content) may
// not send CORS headers, and forcing CORS mode there kills playback entirely.
// So: request CORS only where it is known to work.

export function corsSafe(src: string): boolean {
  if (src.startsWith('lumen://') || src.startsWith('blob:') || src.startsWith('data:')) return true
  try {
    return new URL(src, location.href).origin === location.origin
  } catch {
    return false
  }
}

export function setVideoSource(v: HTMLVideoElement, src: string): void {
  if (corsSafe(src)) v.crossOrigin = 'anonymous'
  else v.removeAttribute('crossorigin')
  v.src = src
}
