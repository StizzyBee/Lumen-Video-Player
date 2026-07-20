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

// Executable names we can drive. Plain mpv.exe comes first EVERYWHERE: the
// mpv.net frontend (mpvnet.exe) speaks the same JSON IPC but owns its own
// window and ignores --wid, so it can never render inside Lumen. Only fall
// back to it when no real mpv exists anywhere on the machine.
const EXES = ['mpv.exe', 'mpvnet.exe']

/** Can this executable render into Lumen's window via --wid? */
export function supportsEmbed(exePath: string): boolean {
  return !/mpvnet\.exe$/i.test(exePath)
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

  // All mpv.exe locations first, then mpvnet.exe as a last resort
  for (const exe of EXES) {
    for (const r of roots) push(join(r, exe))
    for (const d of pathDirs) push(join(d, exe))
  }
  return out
}
