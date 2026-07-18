import { describe, expect, it } from 'vitest'
import { parseSubtitles, activeCues, trackLabelFromPath } from './subtitles'

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
<i>Styled</i> line
second line

`

const VTT = `WEBVTT

NOTE this is a comment

00:01.000 --> 00:03.000
Short-form timestamps

cue-42
00:00:10.500 --> 00:00:12.000
Named cue {\\an8}with override
`

describe('parseSubtitles', () => {
  it('parses SRT blocks with indexes', () => {
    const cues = parseSubtitles(SRT)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 3500, text: 'Hello there.' })
  })
  it('strips markup and ASS overrides, keeps multiline text', () => {
    const cues = parseSubtitles(SRT)
    expect(cues[1].text).toBe('Styled line\nsecond line')
    const vtt = parseSubtitles(VTT)
    expect(vtt[1].text).toBe('Named cue with override')
  })
  it('parses VTT with headers, notes, short timestamps and cue ids', () => {
    const cues = parseSubtitles(VTT)
    expect(cues).toHaveLength(2)
    expect(cues[0].startMs).toBe(1000)
    expect(cues[1].startMs).toBe(10500)
  })
  it('ignores broken blocks', () => {
    expect(parseSubtitles('garbage\nno arrow here')).toHaveLength(0)
  })
})

describe('activeCues', () => {
  const cues = parseSubtitles(SRT)
  it('returns the cue covering the time', () => {
    expect(activeCues(cues, 2000)).toHaveLength(1)
    expect(activeCues(cues, 3800)).toHaveLength(0)
  })
  it('applies positive delay (subtitles later)', () => {
    expect(activeCues(cues, 1200, 500)).toHaveLength(0)
    expect(activeCues(cues, 1600, 500)).toHaveLength(1)
  })
})

describe('trackLabelFromPath', () => {
  it('extracts language token from sidecar names', () => {
    expect(trackLabelFromPath('D:\\v\\Movie.en.srt', 'Movie')).toBe('EN')
  })
  it('falls back to generic label', () => {
    expect(trackLabelFromPath('D:\\v\\Movie.srt', 'Movie')).toBe('Subtitles')
  })
})
