import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LUMEN_UPDATE_FEED } from './updater-feed'

describe('Lumen updater feed', () => {
  it('uses the public GitHub releases repository at runtime', () => {
    expect(LUMEN_UPDATE_FEED).toEqual({
      provider: 'github',
      owner: 'StizzyBee',
      repo: 'Lumen-Video-Player'
    })
  })

  it('ships electron-updater metadata for prepackaged installer builds', () => {
    const config = readFileSync(join(process.cwd(), 'resources', 'app-update.yml'), 'utf8')
    expect(config).toContain('provider: github')
    expect(config).toContain('owner: StizzyBee')
    expect(config).toContain('repo: Lumen-Video-Player')
  })
})
