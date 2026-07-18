import { describe, expect, it } from 'vitest'
import { cleanTitle } from './title'

describe('cleanTitle', () => {
  it('cleans dotted release names with year and tags', () => {
    expect(cleanTitle('The.Grand.Adventure.2019.2160p.WEB-DL.x265-GROUP.mkv')).toBe('The Grand Adventure (2019)')
  })
  it('keeps episode markers and drops quality suffixes', () => {
    expect(cleanTitle('My.Show.S02E05.1080p.WEBRip.mp4')).toBe('My Show S02E05')
  })
  it('handles underscores and bracket groups', () => {
    expect(cleanTitle('[YTS]_Some_Film_720p.mp4')).toBe('Some Film')
  })
  it('leaves plain names alone', () => {
    expect(cleanTitle('Family vacation.mp4')).toBe('Family vacation')
  })
  it('never returns empty', () => {
    expect(cleanTitle('1080p.mp4').length).toBeGreaterThan(0)
  })
  it('appends year when present mid-name', () => {
    expect(cleanTitle('Inception 2010 BluRay.mp4')).toBe('Inception (2010)')
  })
})
