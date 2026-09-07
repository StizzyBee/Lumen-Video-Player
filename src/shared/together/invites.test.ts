import { describe, expect, it } from 'vitest'
import { isLumenId, lumenIdFromMemberId, normalizeLumenId } from './invites'

describe('Lumen IDs', () => {
  it('gives existing installation ids a readable stable form', () => {
    expect(lumenIdFromMemberId('m-ab12cd34ef56')).toBe('LMN-AB12-CD34-EF56')
  })

  it('accepts copied, typed, and compact forms as the same target', () => {
    expect(normalizeLumenId('lmn-ab12-cd34-ef56')).toBe('AB12CD34EF56')
    expect(normalizeLumenId(' AB12 CD34 EF56 ')).toBe('AB12CD34EF56')
    expect(isLumenId('LMN-AB12-CD34-EF56')).toBe(true)
  })

  it('rejects IDs that are too short', () => {
    expect(isLumenId('LMN-1234')).toBe(false)
  })
})
