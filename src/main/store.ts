import { promises as fsp, readFileSync, existsSync, renameSync, copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

type Normalize<T> = (value: unknown) => T | null

/**
 * Minimal persistent JSON document store with atomic writes.
 * - Synchronous load at startup (files are small; avoids async init races)
 * - Debounced save; write-to-temp then rename so a crash can't corrupt data
 * - Previous version kept as .bak and used for recovery on parse failure
 */
export class JsonStore<T> {
  private data: T
  private saveTimer: NodeJS.Timeout | null = null
  private saving = Promise.resolve()
  private saveSequence = 0

  constructor(
    private readonly file: string,
    defaults: T,
    private readonly debounceMs = 400,
    private readonly normalize?: Normalize<T>
  ) {
    this.data = this.load(defaults)
  }

  private load(defaults: T): T {
    for (const candidate of [this.file, this.file + '.bak']) {
      try {
        if (existsSync(candidate)) {
          const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf-8'))
          if (!this.normalize) return parsed as T
          const normalized = this.normalize(parsed)
          if (normalized !== null) return normalized
        }
      } catch {
        // fall through to next candidate
      }
    }
    return defaults
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.scheduleSave()
  }

  update(fn: (current: T) => T): T {
    this.data = fn(this.data)
    this.scheduleSave()
    return this.data
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), this.debounceMs)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const snapshot = JSON.stringify(this.data)
    this.saving = this.saving.then(async () => {
      // Every store shares one user-data directory. Include the destination
      // name and a sequence so simultaneous settings/library/playlist flushes
      // can never overwrite one another's temporary files.
      const tmp = join(
        dirname(this.file),
        `.${basename(this.file)}.${process.pid}.${Date.now()}.${this.saveSequence++}.tmp`
      )
      await fsp.mkdir(dirname(this.file), { recursive: true })
      await fsp.writeFile(tmp, snapshot, 'utf-8')
      try {
        if (existsSync(this.file)) copyFileSync(this.file, this.file + '.bak')
        renameSync(tmp, this.file)
      } catch {
        await fsp.rm(tmp, { force: true })
      }
    })
    await this.saving
  }
}
