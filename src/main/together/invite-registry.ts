import { JsonStore } from '../store'
import { lumenIdFromNumber } from '@shared/together/invites'

interface RegistryData {
  schema: 1
  nextNumber: number
  members: Record<string, number>
}

function normalizeRegistry(value: unknown): RegistryData | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<RegistryData>
  if (raw.schema !== 1 || !raw.members || typeof raw.members !== 'object') return null
  const members: Record<string, number> = {}
  let highest = 0
  for (const [memberId, number] of Object.entries(raw.members)) {
    if (!memberId || memberId.length > 128 || !Number.isSafeInteger(number) || number <= 0) continue
    members[memberId] = number
    highest = Math.max(highest, number)
  }
  const nextNumber = Number.isSafeInteger(raw.nextNumber) && raw.nextNumber! > highest
    ? raw.nextNumber!
    : highest + 1
  return { schema: 1, nextNumber, members }
}

/** Persistent first-seen numbering for the account-free invitation relay. */
export class InviteRegistry {
  private readonly store: JsonStore<RegistryData> | null
  private memory: RegistryData = { schema: 1, nextNumber: 1, members: {} }

  constructor(file?: string) {
    this.store = file
      ? new JsonStore(file, this.memory, 100, normalizeRegistry)
      : null
  }

  register(memberId: string): string {
    const id = String(memberId ?? '').slice(0, 128)
    if (!id) return ''
    const data = this.store?.get() ?? this.memory
    const existing = data.members[id]
    if (existing) return lumenIdFromNumber(existing)
    const number = data.nextNumber
    const next: RegistryData = {
      ...data,
      nextNumber: number + 1,
      members: { ...data.members, [id]: number }
    }
    if (this.store) this.store.set(next)
    else this.memory = next
    return lumenIdFromNumber(number)
  }

  async flush(): Promise<void> {
    await this.store?.flush()
  }
}
