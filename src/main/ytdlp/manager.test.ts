import { describe, expect, it } from 'vitest'
import { buildDownloadArgs } from './manager'

describe('buildDownloadArgs', () => {
  it('uses FFmpeg to merge full-quality streams into MP4', () => {
    const args = buildDownloadArgs('https://example.com/watch/1', 'C:\\Videos', 'C:\\ffmpeg\\ffmpeg.exe')

    expect(args).toContain('--abort-on-unavailable-fragments')
    expect(args).toContain('--progress')
    expect(args).toContain('--ffmpeg-location')
    expect(args).toContain('bv*+ba/b')
    expect(args).toContain('--merge-output-format')
    expect(args).toContain('after_move:__LUMEN_DEST__:%(filepath)s')
    expect(args).not.toContain('--hls-use-mpegts')
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/watch/1'])
  })

  it('keeps HLS in MPEG-TS when FFmpeg is unavailable', () => {
    const args = buildDownloadArgs('https://example.com/watch/2', 'C:\\Videos', null)

    expect(args).toContain('--abort-on-unavailable-fragments')
    expect(args).toContain('--progress')
    expect(args).toContain('--hls-use-mpegts')
    expect(args).toContain('after_move:__LUMEN_DEST__:%(filepath)s')
    expect(args).toContain('b')
    expect(args).not.toContain('--merge-output-format')
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/watch/2'])
  })
})
