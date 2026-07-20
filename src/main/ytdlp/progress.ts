// Pure parser for yt-dlp's --newline output. Turns raw lines into the small
// set of events Lumen's download UI cares about. Unit-tested.

export type YtdlpEvent =
  | { kind: 'progress'; percent: number }
  | { kind: 'dest'; path: string }
  | { kind: 'status'; text: string }
  | { kind: 'error'; text: string }

const PERCENT = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/
const DEST = /^\[download\] Destination: (.+)$/
const MERGED = /^\[Merger\] Merging formats into "(.+)"$/
const ALREADY = /^\[download\] (.+) has already been downloaded/
const FINAL_DEST = /^__LUMEN_DEST__:(.+)$/
const STAGE = /^\[(ExtractAudio|Fixup\w*|Metadata|VideoConvertor|VideoRemuxer)\]/

export function parseYtdlpLine(raw: string): YtdlpEvent | null {
  const line = raw.trim()
  if (!line) return null
  if (line.startsWith('ERROR:')) return { kind: 'error', text: line.slice(6).trim().slice(0, 300) }
  const dest = FINAL_DEST.exec(line) ?? DEST.exec(line) ?? MERGED.exec(line) ?? ALREADY.exec(line)
  if (dest) return { kind: 'dest', path: dest[1] }
  const pct = PERCENT.exec(line)
  if (pct) {
    const p = parseFloat(pct[1])
    return Number.isFinite(p) ? { kind: 'progress', percent: Math.min(100, p) } : null
  }
  if (STAGE.test(line)) return { kind: 'status', text: 'Processing…' }
  if (line.startsWith('[youtube]') || line.startsWith('[info]') || line.startsWith('[generic]')) {
    return { kind: 'status', text: 'Fetching video info…' }
  }
  return null
}
