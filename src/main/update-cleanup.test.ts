import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanupStaleUpdateCache, isNewerInstaller } from './update-cleanup'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function cacheWith(fileName: string): Promise<{ root: string; pending: string }> {
  const root = await fs.mkdtemp(join(tmpdir(), 'lumen-update-cleanup-'))
  roots.push(root)
  const pending = join(root, 'lumen-player-updater', 'pending')
  await fs.mkdir(pending, { recursive: true })
  await fs.writeFile(join(pending, 'update-info.json'), JSON.stringify({ fileName }))
  await fs.writeFile(join(pending, fileName), 'installer')
  return { root, pending }
}

describe('updater cache cleanup', () => {
  it('compares installer versions', () => {
    expect(isNewerInstaller('Lumen-Setup-0.7.0.exe', '0.6.0')).toBe(true)
    expect(isNewerInstaller('Lumen-Setup-0.6.0.exe', '0.6.0')).toBe(false)
    expect(isNewerInstaller('not-an-installer.exe', '0.6.0')).toBe(false)
  })

  it('removes the installer after that version is installed', async () => {
    const { root, pending } = await cacheWith('Lumen-Setup-0.6.0.exe')
    await cleanupStaleUpdateCache('0.6.0', root)
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a genuinely newer pending update', async () => {
    const { root, pending } = await cacheWith('Lumen-Setup-0.7.0.exe')
    await cleanupStaleUpdateCache('0.6.0', root)
    await expect(fs.stat(pending)).resolves.toBeTruthy()
  })
})
