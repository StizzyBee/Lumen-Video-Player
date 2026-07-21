import { describe, expect, it } from 'vitest'
import { normalizeLibraryState } from './library'

describe('normalizeLibraryState', () => {
  it('rejects a settings document so JsonStore can recover the library backup', () => {
    expect(normalizeLibraryState({ schema: 1, theme: {}, playback: {} })).toBeNull()
  })

  it('migrates older library documents with missing fields', () => {
    expect(normalizeLibraryState({ items: [], revision: 3 })).toEqual({
      revision: 3,
      folders: [],
      items: []
    })
  })
})
