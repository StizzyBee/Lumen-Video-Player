// Where to look for yt-dlp.exe and ffmpeg.exe. Pure candidate-list builders so
// probing order is unit-testable; existence checks live in the manager.
// winget installs both as "portable" packages symlinked into
// %LOCALAPPDATA%\Microsoft\WinGet\Links, which is also usually on PATH.
import { join } from 'node:path'

export interface ToolEnv {
  /** User-configured explicit yt-dlp path (from settings), if any */
  userPath?: string
  pathEnv?: string
  localAppData?: string
  programFiles?: string
}

function pathDirs(pathEnv?: string): string[] {
  return (pathEnv ?? '')
    .split(';')
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

function candidates(exe: string, roots: Array<string | undefined>, env: ToolEnv): string[] {
  const out: string[] = []
  const push = (p?: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }
  for (const r of roots) if (r) push(join(r, exe))
  for (const d of pathDirs(env.pathEnv)) push(join(d, exe))
  return out
}

/** Ordered candidate paths for yt-dlp.exe (first existing wins). */
export function ytdlpCandidates(env: ToolEnv): string[] {
  const out: string[] = []
  if (env.userPath) out.push(env.userPath)
  const links = env.localAppData && join(env.localAppData, 'Microsoft', 'WinGet', 'Links')
  const roots = [links, env.localAppData && join(env.localAppData, 'Programs', 'yt-dlp')]
  for (const p of candidates('yt-dlp.exe', roots, env)) if (!out.includes(p)) out.push(p)
  return out
}

/** Ordered candidate paths for ffmpeg.exe (yt-dlp needs it to merge 1080p+). */
export function ffmpegCandidates(env: ToolEnv): string[] {
  const links = env.localAppData && join(env.localAppData, 'Microsoft', 'WinGet', 'Links')
  const roots = [links, env.programFiles && join(env.programFiles, 'ffmpeg', 'bin')]
  return candidates('ffmpeg.exe', roots, env)
}
