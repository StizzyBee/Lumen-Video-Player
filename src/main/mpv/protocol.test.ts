import { describe, expect, it } from 'vitest'
import { encodeCommand, parseMessages, cmd, isEvent, OBSERVED, parseTrackList } from './protocol'

describe('encodeCommand', () => {
  it('serializes a command with a trailing newline', () => {
    expect(encodeCommand(['loadfile', 'C:\\v.mkv', 'replace'], 7)).toBe(
      '{"command":["loadfile","C:\\\\v.mkv","replace"],"request_id":7}\n'
    )
  })
  it('omits request_id when not given', () => {
    expect(encodeCommand(['cycle', 'pause'])).toBe('{"command":["cycle","pause"]}\n')
  })
})

describe('command builders', () => {
  it('build the expected mpv verbs', () => {
    expect(cmd.loadfile('a.mkv')).toEqual(['loadfile', 'a.mkv', 'replace'])
    expect(cmd.setProp('volume', 80)).toEqual(['set_property', 'volume', 80])
    expect(cmd.seek(42.5)).toEqual(['seek', 42.5, 'absolute', 'exact'])
    expect(cmd.observe(3, 'pause')).toEqual(['observe_property', 3, 'pause'])
  })
})

describe('parseMessages', () => {
  it('extracts complete lines and keeps the partial remainder', () => {
    const a = parseMessages('{"event":"file-loaded"}\n{"request_id":1,"dat')
    expect(a.messages).toHaveLength(1)
    expect(a.messages[0].event).toBe('file-loaded')
    expect(a.rest).toBe('{"request_id":1,"dat')
    const b = parseMessages(a.rest + 'a":123,"error":"success"}\n')
    expect(b.messages[0].data).toBe(123)
    expect(b.rest).toBe('')
  })
  it('skips blank and malformed lines without throwing', () => {
    const r = parseMessages('\nnot json\n{"event":"seek"}\n')
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0].event).toBe('seek')
  })
  it('handles property-change events', () => {
    const r = parseMessages('{"event":"property-change","name":"time-pos","data":12.3}\n')
    expect(isEvent(r.messages[0])).toBe(true)
    expect(r.messages[0].name).toBe('time-pos')
    expect(r.messages[0].data).toBe(12.3)
  })
})

describe('parseTrackList', () => {
  it('splits audio and subtitle tracks with labels and selection', () => {
    const t = parseTrackList([
      { id: 1, type: 'video', codec: 'hevc', selected: true },
      { id: 1, type: 'audio', title: 'Surround', lang: 'eng', codec: 'eac3', selected: true },
      { id: 2, type: 'audio', lang: 'jpn', codec: 'aac', selected: false },
      { id: 1, type: 'sub', lang: 'eng', selected: false },
      { id: 2, type: 'sub', title: 'Forced', selected: true }
    ])
    expect(t.audio).toHaveLength(2)
    expect(t.sub).toHaveLength(2)
    expect(t.audio[0]).toEqual({ id: 1, label: 'Surround', lang: 'ENG', selected: true })
    expect(t.audio[1].label).toBe('JPN · AAC')
    expect(t.sub[1]).toMatchObject({ id: 2, label: 'Forced', selected: true })
  })
  it('tolerates non-array / empty input', () => {
    expect(parseTrackList(null)).toEqual({ audio: [], sub: [] })
    expect(parseTrackList([{ type: 'audio' }])).toEqual({ audio: [], sub: [] })
  })
})

describe('OBSERVED', () => {
  it('has unique ids and covers transport essentials', () => {
    const ids = OBSERVED.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = OBSERVED.map((o) => o.name)
    expect(names).toContain('time-pos')
    expect(names).toContain('duration')
    expect(names).toContain('pause')
  })
})
