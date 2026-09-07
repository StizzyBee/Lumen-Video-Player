import { randomUUID } from 'node:crypto'
import { lumenIdFromNumber, normalizeLumenId } from '@shared/together/invites'
import type { InstallationIdentity } from '@shared/types'
import { JsonStore } from './store'

function isMemberId(value: unknown): value is string {
  return typeof value === 'string' && /^m-[a-z0-9-]{8,124}$/i.test(value)
}

function createMemberId(legacy: unknown): string {
  return isMemberId(legacy) ? legacy : `m-${randomUUID().replace(/-/g, '')}`
}

function normalizeIdentity(value: unknown): InstallationIdentity | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<InstallationIdentity>
  if (raw.schema !== 1 || !isMemberId(raw.memberId)) return null
  const number = Number(normalizeLumenId(String(raw.lumenId ?? '')))
  return {
    schema: 1,
    memberId: raw.memberId,
    lumenId: lumenIdFromNumber(number)
  }
}

/**
 * Install-scoped identity, kept outside application binaries and settings.
 * The secret member key is generated locally; the public short number is
 * remembered after the authoritative invitation relay assigns it.
 */
export class InstallationIdentityStore {
  private readonly store: JsonStore<InstallationIdentity>

  constructor(file: string, legacyMemberId = '') {
    this.store = new JsonStore(
      file,
      { schema: 1, memberId: createMemberId(legacyMemberId), lumenId: '' },
      100,
      normalizeIdentity
    )
    // JsonStore only writes after a mutation. Touch the loaded/default value
    // so a brand-new install gets identity.json during this startup.
    this.store.set(this.store.get())
  }

  get(): InstallationIdentity {
    return { ...this.store.get() }
  }

  rememberLumenId(value: string): void {
    const number = Number(normalizeLumenId(value))
    const lumenId = lumenIdFromNumber(number)
    if (!lumenId || lumenId === this.store.get().lumenId) return
    this.store.update((current) => ({ ...current, lumenId }))
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}
