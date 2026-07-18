import { describe, expect, it } from 'vitest'
import { toggleBookmark, removeBookmark } from './bookmarks'

describe('toggleBookmark', () => {
  it('adds to an empty list, rounded and sorted', () => {
    expect(toggleBookmark(undefined, 12.34)).toEqual({ list: [12.3], added: true })
    expect(toggleBookmark([30], 10).list).toEqual([10, 30])
  })
  it('removes the nearest bookmark within the merge window instead of stacking', () => {
    const { list, added } = toggleBookmark([10, 30], 11.5)
    expect(added).toBe(false)
    expect(list).toEqual([30])
  })
  it('adds when outside the merge window', () => {
    const { list, added } = toggleBookmark([10], 14.5)
    expect(added).toBe(true)
    expect(list).toEqual([10, 14.5])
  })
  it('removes only the nearest of several candidates', () => {
    const { list } = toggleBookmark([10, 12], 11.9)
    expect(list).toEqual([10])
  })
})

describe('removeBookmark', () => {
  it('removes exact matches and tolerates missing lists', () => {
    expect(removeBookmark([1, 2, 3], 2)).toEqual([1, 3])
    expect(removeBookmark(undefined, 2)).toEqual([])
  })
})
