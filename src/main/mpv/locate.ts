// Where to look for an installed mpv.exe. Pure candidate-list builder so the
// probing order is unit-testable; the actual existence check lives in manager.
import { join } from 'node:path'

export interface LocateEnv {
  /** User-configured explicit path (from settings), if any */
  userPath?: string
  /** Bundled copy shipped with the app, if present */
  bundledPath?: string
  /** PATH environment variable */
  pathEnv?: string
  /** LOCALAPPDATA / ProgramFiles for common install locations */
  localAppData?: string
  programFiles?: string
  programFilesX86?: string
}

// Executable names we can drive (plain mpv, and the mpv.net frontend which is
// mpv-compatible and supports --input-ipc-server).
const EXES = ['mpv.exe', 'mpvnet.exe']

/** Ordered list of candidate mpv executable paths to probe (first existing wins). */
export function mpvCandidates(env: LocateEnv): string[] {
  const out: string[] = []
  const push = (p?: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }

  push(env.userPath)
  push(env.bundledPath)

  // winget/scoop/choco and manual installs (plain mpv and mpv.net)
  const roots = [
    env.programFiles && join(env.programFiles, 'mpv'),
    env.programFiles && join(env.programFiles, 'mpv.net'),
    env.programFilesX86 && join(env.programFilesX86, 'mpv'),
    env.localAppData && join(env.localAppData, 'Microsoft', 'WinGet', 'Links'),
    env.localAppData && join(env.localAppData, 'Programs', 'mpv'),
    env.localAppData && join(env.localAppData, 'Programs', 'mpv.net'),
    env.localAppData && join(env.localAppData, 'mpv')
  ].filter(Boolean) as string[]
  for (const r of roots) for (const exe of EXES) push(join(r, exe))

  // Anything on PATH
  for (const dir of (env.pathEnv ?? '').split(';')) {
    const d = dir.trim().replace(/^"|"$/g, '')
    if (d) for (const exe of EXES) push(join(d, exe))
  }
  return out
}
