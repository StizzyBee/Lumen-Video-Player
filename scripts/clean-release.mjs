import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const project = resolve(import.meta.dirname, '..')
const release = resolve(project, 'release')

if (dirname(release) !== project || basename(release) !== 'release') {
  throw new Error(`Refusing to clean unexpected output path: ${release}`)
}

// Build output is fully reproducible. Starting clean prevents installers from
// every historical version accumulating on a maintainer's machine or in a
// manually persisted build directory.
await rm(release, { recursive: true, force: true })
