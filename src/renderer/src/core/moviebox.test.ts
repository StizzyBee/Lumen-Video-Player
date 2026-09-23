import { describe, expect, it } from 'vitest'
import { authorizedMovieBoxUrl, movieBoxCommandEffect } from './moviebox-logic'

describe('authorizedMovieBoxUrl', () => {
  it('allows HTTP(S) media and rejects local or executable schemes', () => {
    expect(authorizedMovieBoxUrl('https://media.example/movie.m3u8')).toBe('https://media.example/movie.m3u8')
    expect(authorizedMovieBoxUrl('file:///C:/secret.mp4')).toBeNull()
    expect(authorizedMovieBoxUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('movieBoxCommandEffect', () => {
  it('normalizes common transport commands', () => {
    expect(movieBoxCommandEffect({ Action: 'Pause', Values: {} })).toEqual({ type: 'pause' })
    expect(movieBoxCommandEffect({ Action: 'TimeChanged', Values: { CurTime: 42 } })).toEqual({ type: 'seek', value: 42 })
    expect(movieBoxCommandEffect({ Action: 'SetRate', Values: { Rate: 1.5 } })).toEqual({ type: 'rate', value: 1.5 })
  })
})
