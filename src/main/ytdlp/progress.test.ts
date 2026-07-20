import { describe, expect, it } from 'vitest'
import { parseYtdlpLine } from './progress'

describe('parseYtdlpLine', () => {
  it('parses download percentages', () => {
    expect(parseYtdlpLine('[download]  42.3% of ~ 123.45MiB at 2.34MiB/s ETA 00:12')).toEqual({
      kind: 'progress',
      percent: 42.3
    })
    expect(parseYtdlpLine('[download] 100% of 10.00MiB in 00:05')).toEqual({ kind: 'progress', percent: 100 })
  })

  it('captures the destination path (download, merge, already-downloaded)', () => {
    expect(parseYtdlpLine('[download] Destination: C:\\Videos\\Lumen Downloads\\Clip [abc123].mp4')).toEqual({
      kind: 'dest',
      path: 'C:\\Videos\\Lumen Downloads\\Clip [abc123].mp4'
    })
    expect(parseYtdlpLine('[Merger] Merging formats into "C:\\v\\out.mp4"')).toEqual({
      kind: 'dest',
      path: 'C:\\v\\out.mp4'
    })
    expect(parseYtdlpLine('[download] C:\\v\\out.mp4 has already been downloaded')).toEqual({
      kind: 'dest',
      path: 'C:\\v\\out.mp4'
    })
  })

  it('surfaces errors', () => {
    expect(parseYtdlpLine('ERROR: [youtube] abc: Video unavailable')).toEqual({
      kind: 'error',
      text: '[youtube] abc: Video unavailable'
    })
  })

  it('maps extractor/processing chatter to statuses and ignores noise', () => {
    expect(parseYtdlpLine('[youtube] abc: Downloading webpage')?.kind).toBe('status')
    expect(parseYtdlpLine('[FixupM3u8] Fixing MPEG-TS in MP4 container')?.kind).toBe('status')
    expect(parseYtdlpLine('')).toBeNull()
    expect(parseYtdlpLine('random noise')).toBeNull()
  })
})
