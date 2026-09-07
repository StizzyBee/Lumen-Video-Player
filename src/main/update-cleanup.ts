import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

interface CachedUpdateInfo {
  fileName?: unknown
}

function versionParts(value: string): number[] | null {
  const match = /(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/.exec(value)
  return match ? match.slice(1, 4).map(Number) : null
}

export function isNewerInstaller(fileName: string, currentVersion: string): boolean {
  const cached = versionParts(fileName)
  const current = versionParts(currentVersion)
  if (!cached || !current) return false
  for (let index = 0; index < 3; index++) {
    if (cached[index] !== current[index]) return cached[index] > current[index]
  }
  return false
}

/**
 * Remove app-owned updater downloads once their version is installed. The
 * browser's Downloads folder is deliberately out of scope: Lumen must never
 * delete a file the user downloaded or moved themselves.
 */
export async function cleanupStaleUpdateCache(currentVersion: string, localAppData?: string): Promise<void> {
  if (!localAppData || !isAbsolute(localAppData)) return
  const base = resolve(localAppData)
  const cache = resolve(base, 'lumen-player-updater')
  if (!cache.startsWith(base + '\\') && !cache.startsWith(base + '/')) return
  const pending = join(cache, 'pending')

  let keepPending = false
  try {
    const raw = JSON.parse(await fs.readFile(join(pending, 'update-info.json'), 'utf8')) as CachedUpdateInfo
    keepPending = typeof raw.fileName === 'string' && isNewerInstaller(raw.fileName, currentVersion)
  } catch {
    // Missing/corrupt metadata cannot describe a resumable verified update.
  }
  if (!keepPending) await fs.rm(pending, { recursive: true, force: true }).catch(() => {})

  // Interrupted differential downloads use temp-/0-temp- names beside the
  // single current installer cache. They are never valid resume candidates.
  try {
    const entries = await fs.readdir(cache, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !/^(?:\d+-)?temp-.*\.(?:exe|blockmap)$/i.test(entry.name)) return
      await fs.rm(join(cache, entry.name), { force: true }).catch(() => {})
    }))
  } catch {
    // No updater cache yet is the normal first-run case.
  }
}
