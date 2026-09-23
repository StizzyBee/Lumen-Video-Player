import { join } from 'node:path'

export const MOVIEBOX_BRIDGE_VERSION = '0.6.7'
export const MOVIEBOX_HOOK_SHA256 = '44a39e82b2e3e65c6ddbb969968b98935918844025ea727a38660faca003d3d9'
export const MOVIEBOX_HARMONY_SHA256 = '4b5f44764316c833a3b1d184ba6f1df275c86a181cc595ec403a01049d1d6fb5'
const RELEASE_BASE = `https://github.com/StizzyBee/Lumen-Video-Player/releases/download/v${MOVIEBOX_BRIDGE_VERSION}`
export const MOVIEBOX_HOOK_URL = `${RELEASE_BASE}/MovieBoxPlayerMod.Hook.dll`
export const MOVIEBOX_HARMONY_URL = `${RELEASE_BASE}/0Harmony.dll`

export function movieBoxCandidates(env: NodeJS.ProcessEnv): string[] {
  const local = env.LOCALAPPDATA
  const programFiles = env.ProgramFiles
  const programFilesX86 = env['ProgramFiles(x86)']
  return [
    local && join(local, 'Programs', 'MovieBoxPro', 'MovieBoxPro.exe'),
    local && join(local, 'Programs', 'MovieBox Pro', 'MovieBoxPro.exe'),
    local && join(local, 'MovieBoxPro', 'MovieBoxPro.exe'),
    programFiles && join(programFiles, 'MovieBoxPro', 'MovieBoxPro.exe'),
    programFilesX86 && join(programFilesX86, 'MovieBoxPro', 'MovieBoxPro.exe')
  ].filter((value): value is string => !!value)
}

export function movieBoxLaunchEnvironment(
  base: NodeJS.ProcessEnv,
  hookPath: string,
  lumenPath: string
): NodeJS.ProcessEnv {
  return {
    ...base,
    MOVIEBOX_PLAYER: 'LUMEN',
    LUMEN_PLAYER_EXE: lumenPath,
    DOTNET_STARTUP_HOOKS: hookPath
  }
}
