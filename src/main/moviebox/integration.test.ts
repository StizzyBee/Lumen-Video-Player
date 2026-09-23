import { describe, expect, it } from 'vitest'
import { movieBoxCandidates, movieBoxLaunchEnvironment } from './integration-logic'

describe('movieBoxCandidates', () => {
  it('builds only local install candidates from available roots', () => {
    expect(movieBoxCandidates({ LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' })).toEqual([
      'C:\\Users\\A\\AppData\\Local\\Programs\\MovieBoxPro\\MovieBoxPro.exe',
      'C:\\Users\\A\\AppData\\Local\\Programs\\MovieBox Pro\\MovieBoxPro.exe',
      'C:\\Users\\A\\AppData\\Local\\MovieBoxPro\\MovieBoxPro.exe'
    ])
  })
})

describe('movieBoxLaunchEnvironment', () => {
  it('scopes the startup hook to the launched MovieBox process', () => {
    const env = movieBoxLaunchEnvironment(
      { KEEP: 'yes' },
      'C:\\Bridge\\Hook.dll',
      'C:\\Lumen\\Lumen.exe',
      'MovieBoxPlayerMod-prewarm'
    )
    expect(env).toMatchObject({
      KEEP: 'yes',
      MOVIEBOX_PLAYER: 'LUMEN',
      LUMEN_PLAYER_EXE: 'C:\\Lumen\\Lumen.exe',
      DOTNET_STARTUP_HOOKS: 'C:\\Bridge\\Hook.dll',
      LUMEN_MOVIEBOX_PIPE: 'MovieBoxPlayerMod-prewarm'
    })
  })
})
