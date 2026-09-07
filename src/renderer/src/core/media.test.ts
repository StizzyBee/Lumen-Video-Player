import { describe, expect, it } from 'vitest'
import { corsSafe } from './media'

describe('media CORS mode', () => {
  it('recognises Together token streams as CORS-safe', () => {
    expect(corsSafe(`http://friend:7345/stream/${'a'.repeat(32)}`)).toBe(true)
    expect(corsSafe(`https://relay.example/stream/${'B'.repeat(32)}?cache=0`)).toBe(true)
  })

  it('does not force CORS mode on arbitrary remote video links', () => {
    expect(corsSafe('https://cdn.example/video.mp4')).toBe(false)
  })
})
