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
    const pageUrl = typeof location === 'undefined' ? 'http://localhost/' : location.href
    const url = new URL(src, pageUrl)
    // The Together relay always supplies Access-Control-Allow-Origin. Its URL
    // has no file extension by design, so identify it by the unguessable token
    // route and keep screenshots/frame capture available to guests.
    if (/^\/stream\/[0-9a-f]{32}$/i.test(url.pathname)) return true
    return typeof location !== 'undefined' && url.origin === location.origin
  } catch {
    return false
  }
}

export function setVideoSource(v: HTMLVideoElement, src: string): void {
  if (corsSafe(src)) v.crossOrigin = 'anonymous'
  else v.removeAttribute('crossorigin')
  v.src = src
}
