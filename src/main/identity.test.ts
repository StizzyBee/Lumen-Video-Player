import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InstallationIdentityStore } from './identity'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'lumen-identity-'))
  created.push(dir)
  return join(dir, 'identity.json')
}

describe('InstallationIdentityStore', () => {
  it('creates one install key and reuses it after restart', async () => {
    const file = await tempFile()
    const first = new InstallationIdentityStore(file)
    const memberId = first.get().memberId
    await first.flush()

    const restarted = new InstallationIdentityStore(file)
    expect(restarted.get()).toEqual({ schema: 1, memberId, lumenId: '' })
  })

  it('migrates the old settings member key and remembers the relay number', async () => {
    const file = await tempFile()
    const first = new InstallationIdentityStore(file, 'm-existing-install')
    first.rememberLumenId('lumen #27')
    await first.flush()

    const restarted = new InstallationIdentityStore(file, 'm-ignored-new-value')
    expect(restarted.get()).toEqual({
      schema: 1,
      memberId: 'm-existing-install',
      lumenId: 'LMN-27'
    })
  })
})
