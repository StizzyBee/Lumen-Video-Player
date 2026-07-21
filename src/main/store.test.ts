import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from './store'

let root: string | null = null

afterEach(() => {
  vi.restoreAllMocks()
  if (root) rmSync(root, { recursive: true, force: true })
  root = null
})

describe('JsonStore', () => {
  it('keeps simultaneous store flushes isolated even in the same millisecond', async () => {
    root = mkdtempSync(join(tmpdir(), 'lumen-stores-'))
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    const settings = new JsonStore(join(root, 'settings.json'), { kind: 'settings', value: 0 }, 60_000)
    const library = new JsonStore(join(root, 'library.json'), { kind: 'library', value: 0 }, 60_000)

    settings.set({ kind: 'settings', value: 1 })
    library.set({ kind: 'library', value: 2 })
    await Promise.all([settings.flush(), library.flush()])

    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({ kind: 'settings', value: 1 })
    expect(JSON.parse(readFileSync(join(root, 'library.json'), 'utf8'))).toEqual({ kind: 'library', value: 2 })
  })

  it('falls back to a valid backup when the primary document has the wrong shape', () => {
    root = mkdtempSync(join(tmpdir(), 'lumen-store-recovery-'))
    const file = join(root, 'library.json')
    const backup = file + '.bak'
    writeFileSync(file, JSON.stringify({ theme: 'not a library' }))
    writeFileSync(backup, JSON.stringify({ items: ['restored'] }))

    const store = new JsonStore(
      file,
      { items: [] as string[] },
      400,
      (value) => {
        if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) return null
        return value as { items: string[] }
      }
    )

    expect(store.get()).toEqual({ items: ['restored'] })
  })
})
