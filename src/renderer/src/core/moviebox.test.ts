import { describe, expect, it } from 'vitest'
import { authorizedMovieBoxUrl, movieBoxCommandEffect, movieBoxEpisodeNavigation } from './moviebox-logic'

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

describe('movieBoxEpisodeNavigation', () => {
  const episodes = [
    { Id: '1:1', Label: 'E1', Group: 'Season 1', Selected: false },
    { Id: '1:2', Label: 'E2', Group: 'Season 1', Selected: true },
    { Id: '1:3', Label: 'E3', Group: 'Season 1', Selected: false }
  ]

  it('enables both directions from a middle episode', () => {
    expect(movieBoxEpisodeNavigation(true, true, episodes)).toEqual({ canPrevious: true, canNext: true })
  })

  it('bounds navigation at the first and last episode', () => {
    expect(movieBoxEpisodeNavigation(true, true, episodes.map((e, i) => ({ ...e, Selected: i === 0 })))).toEqual({
      canPrevious: false,
      canNext: true
    })
    expect(movieBoxEpisodeNavigation(true, true, episodes.map((e, i) => ({ ...e, Selected: i === 2 })))).toEqual({
      canPrevious: true,
      canNext: false
    })
  })
})
