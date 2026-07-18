// Filename → display title cleaning. Pure logic, unit-tested.

const RELEASE_TAGS = new RegExp(
  '\\b(' +
    [
      '480p', '720p', '1080p', '1440p', '2160p', '4320p', '4k', '8k', 'uhd', 'hd', 'fhd',
      'x264', 'x265', 'h264', 'h265', 'h\\.264', 'h\\.265', 'hevc', 'avc', 'av1', 'vp9', 'xvid', 'divx',
      'web[- ]?dl', 'webrip', 'web', 'bluray', 'blu-ray', 'brrip', 'bdrip', 'dvdrip', 'hdrip', 'hdtv', 'remux',
      'aac(?:2\\.0|5\\.1)?', 'ac3', 'eac3', 'dd5\\.1', 'ddp5\\.1', 'dts(?:-hd)?', 'truehd', 'atmos', 'opus', 'flac',
      '10[- ]?bit', '8[- ]?bit', 'hdr10?(?:\\+)?', 'dv', 'dolby[- ]?vision', 'sdr',
      'amzn', 'nf', 'dsnp', 'hulu', 'hmax', 'atvp',
      'proper', 'repack', 'extended', 'unrated', 'remastered', 'imax', 'multi', 'dual[- ]?audio', 'subbed', 'dubbed'
    ].join('|') +
    ')\\b',
  'gi'
)

const GROUP_SUFFIX = /[-.]\s*[A-Za-z0-9]+$/
const EPISODE = /\b(s\d{1,2}[ ._-]?e\d{1,3}|\d{1,2}x\d{2,3})\b/i

/** "The.Movie.2019.2160p.WEB-DL.x265-GROUP.mkv" → "The Movie (2019)" */
export function cleanTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  let s = base

  // Remove bracketed junk like [YTS], (RARBG)
  s = s.replace(/[[({][^\])}]*[\])}]/g, ' ')

  // Dots/underscores as separators (only when they clearly are separators)
  const dotty = (s.match(/\./g)?.length ?? 0) >= 2
  if (dotty) s = s.replace(/\./g, ' ')
  s = s.replace(/_/g, ' ')

  // Keep episode markers (S01E02) but drop everything a year/quality tag onward
  const ep = s.match(EPISODE)
  const year = s.match(/\b(19\d{2}|20\d{2})\b/)
  let title = s
  let cutAt = -1
  const firstTag = s.search(RELEASE_TAGS)
  if (year && year.index !== undefined && year.index > 0) cutAt = year.index
  if (firstTag > 0 && (cutAt === -1 || firstTag < cutAt)) cutAt = firstTag
  if (ep && ep.index !== undefined) {
    // For episodes: keep "Show S01E02" and drop the rest
    const epEnd = ep.index + ep[0].length
    title = s.slice(0, epEnd)
  } else if (cutAt > 0) {
    title = s.slice(0, cutAt)
  } else {
    title = s.replace(RELEASE_TAGS, ' ')
  }

  title = title
    .replace(GROUP_SUFFIX, (m) => (EPISODE.test(m) ? m : ' '))
    .replace(/[-–—\s]+$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (ep) title = title.replace(EPISODE, (m) => m.toUpperCase().replace(/[ ._-]/g, ''))

  if (!title) title = base.trim()
  if (year && !ep && !title.includes(year[1])) title = `${title} (${year[1]})`
  return title
}
