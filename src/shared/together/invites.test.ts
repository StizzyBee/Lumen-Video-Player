import { describe, expect, it } from 'vitest'
import { isLumenId, lumenIdFromNumber, normalizeLumenId } from './invites'

describe('Lumen IDs', () => {
  it('formats the relay-assigned player number', () => {
    expect(lumenIdFromNumber(1)).toBe('LMN-1')
    expect(lumenIdFromNumber(25_000)).toBe('LMN-25000')
  })

  it('accepts copied and conversational forms as the same target', () => {
    expect(normalizeLumenId('LMN-25')).toBe('25')
    expect(normalizeLumenId(' Lumen #25 ')).toBe('25')
    expect(isLumenId('LMN-25')).toBe(true)
  })

  it('rejects zero and non-numeric IDs', () => {
    expect(isLumenId('LMN-0')).toBe(false)
    expect(isLumenId('LMN-ANA')).toBe(false)
    expect(isLumenId('LMN-ANA2')).toBe(false)
  })
})
