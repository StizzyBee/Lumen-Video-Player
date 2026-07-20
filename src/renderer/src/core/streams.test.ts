import { describe, expect, it } from 'vitest'
import { normalizeStreamUrl, isDirectMediaUrl, streamTitle, makeStreamItem, isStreamItem, streamExt } from './streams'

describe('normalizeStreamUrl', () => {
  it('accepts http(s) URLs as-is', () => {
    expect(normalizeStreamUrl('https://example.com/v.mp4')).toBe('https://example.com/v.mp4')
    expect(normalizeStreamUrl('  http://example.com/v ')).toBe('http://example.com/v')
  })
  it('prefixes https:// for bare domains', () => {
    expect(normalizeStreamUrl('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
    expect(normalizeStreamUrl('www.example.com')).toBe('https://www.example.com/')
  })
  it('rejects non-URLs and other schemes', () => {
    expect(normalizeStreamUrl('')).toBeNull()
    expect(normalizeStreamUrl('not a url')).toBeNull()
    expect(normalizeStreamUrl('file:///C:/x.mp4')).toBeNull()
    expect(normalizeStreamUrl('ftp://host/x.mp4')).toBeNull()
    expect(normalizeStreamUrl('C:\\videos\\x.mp4')).toBeNull()
  })
})

describe('direct media detection', () => {
  it('spots direct file links the built-in engine can play', () => {
    expect(isDirectMediaUrl('https://cdn.example.com/movie.mp4')).toBe(true)
    expect(isDirectMediaUrl('https://cdn.example.com/movie.webm?token=1')).toBe(true)
    expect(isDirectMediaUrl('https://www.youtube.com/watch?v=abc')).toBe(false)
    expect(isDirectMediaUrl('https://cdn.example.com/movie.mkv')).toBe(false)
  })
  it('extracts extensions from the path only', () => {
    expect(streamExt('https://x.com/a/b.mp4?d=.mkv')).toBe('mp4')
    expect(streamExt('https://x.com/watch')).toBe('')
  })
})

describe('stream items', () => {
  it('titles direct links by file name, sites by host', () => {
    expect(streamTitle('https://cdn.example.com/My%20Movie.mp4')).toBe('My Movie')
    expect(streamTitle('https://www.youtube.com/watch?v=abc')).toBe('youtube.com')
  })
  it('builds a marked, never-persisted item', () => {
    const item = makeStreamItem('https://cdn.example.com/clip.mp4')
    expect(item.path).toBe('https://cdn.example.com/clip.mp4')
    expect(item.ext).toBe('mp4')
    expect(isStreamItem(item)).toBe(true)
    expect(isStreamItem({ id: 'abc123' })).toBe(false)
  })
})
