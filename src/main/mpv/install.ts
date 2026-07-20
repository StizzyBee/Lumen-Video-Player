// One-click mpv install via winget (shared plumbing in ../winget.ts).
// Plain mpv — NOT mpv.net — because only real mpv.exe accepts --wid and can
// render inside Lumen's window; mpv.net always opens its own window.
// The caller confirms success by re-detecting mpv on disk, never by exit code.
import { hasWinget, wingetInstall, type WingetOutcome } from '../winget'

export type InstallReason = 'no-winget' | 'failed'
export interface InstallOutcome {
  ok: boolean
  reason?: InstallReason
}

export { hasWinget }

export function installMpvViaWinget(onProgress: (line: string) => void): Promise<InstallOutcome> {
  return wingetInstall('shinchiro.mpv', onProgress) as Promise<WingetOutcome>
}
