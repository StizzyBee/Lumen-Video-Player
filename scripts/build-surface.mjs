import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32') process.exit(0)

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'tools', 'Lumen.SurfaceHost', 'Program.cs')
const output = join(root, 'resources', 'surface', 'Lumen.SurfaceHost.exe')
const windowsDir = process.env.WINDIR || 'C:\\Windows'
const compilers = [
  join(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
]
const compiler = compilers.find(existsSync)

if (!compiler) throw new Error('The Windows C# compiler required for Lumen.SurfaceHost was not found')
mkdirSync(dirname(output), { recursive: true })

const result = spawnSync(
  compiler,
  ['/nologo', '/optimize+', '/target:exe', `/out:${output}`, source],
  { cwd: root, encoding: 'utf8', windowsHide: true }
)

if (result.status !== 0) {
  throw new Error(`Lumen.SurfaceHost build failed:\n${result.stdout || ''}${result.stderr || ''}`)
}

console.log(`Built ${output}`)
