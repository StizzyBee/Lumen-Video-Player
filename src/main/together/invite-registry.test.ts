import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InviteRegistry } from './invite-registry'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

describe('InviteRegistry', () => {
  it('assigns short numbers in first-seen order', () => {
    const registry = new InviteRegistry()
    expect(registry.register('secret-a')).toBe('LMN-1')
    expect(registry.register('secret-b')).toBe('LMN-2')
    expect(registry.register('secret-a')).toBe('LMN-1')
  })

  it('keeps a number across relay restarts', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lumen-invites-'))
    created.push(dir)
    const file = join(dir, 'registry.json')
    const first = new InviteRegistry(file)
    expect(first.register('secret-a')).toBe('LMN-1')
    await first.flush()

    const restarted = new InviteRegistry(file)
    expect(restarted.register('secret-a')).toBe('LMN-1')
    expect(restarted.register('secret-b')).toBe('LMN-2')
  })
})
