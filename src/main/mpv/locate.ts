// Where to look for an installed mpv.exe. Pure candidate-list builder so the
// probing order is unit-testable; the actual existence check lives in manager.
import { join, win32 } from 'node:path'

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

// Lumen only accepts plain mpv. Frontends such as mpv.net own a separate UI
// and cannot render into Lumen through --wid.
const EXES = ['mpv.exe']

/** Can this executable render into Lumen's window via --wid? */
export function supportsEmbed(exePath: string): boolean {
  return win32.basename(exePath).toLowerCase() === 'mpv.exe'
}

/** Ordered list of candidate mpv executable paths to probe (first existing wins). */
export function mpvCandidates(env: LocateEnv): string[] {
  const out: string[] = []
  const push = (p?: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }

  push(env.userPath)
  push(env.bundledPath)

  // winget/scoop/choco and manual installs (plain mpv and mpv.net).
  // "MPV Player" is where the shinchiro.mpv winget package installs.
  const roots = [
    env.programFiles && join(env.programFiles, 'mpv'),
    env.programFiles && join(env.programFiles, 'MPV Player'),
    env.programFiles && join(env.programFiles, 'mpv.net'),
    env.programFilesX86 && join(env.programFilesX86, 'mpv'),
    env.programFilesX86 && join(env.programFilesX86, 'MPV Player'),
    env.localAppData && join(env.localAppData, 'Microsoft', 'WinGet', 'Links'),
    env.localAppData && join(env.localAppData, 'Programs', 'mpv'),
    env.localAppData && join(env.localAppData, 'Programs', 'mpv.net'),
    env.localAppData && join(env.localAppData, 'mpv')
  ].filter(Boolean) as string[]
  const pathDirs = (env.pathEnv ?? '')
    .split(';')
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)

  // Only enumerate executables that can render inside Lumen.
  for (const exe of EXES) {
    for (const r of roots) push(join(r, exe))
    for (const d of pathDirs) push(join(d, exe))
  }
  return out
}
