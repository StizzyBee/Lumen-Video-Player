import { describe, expect, it } from 'vitest'
import { mpvCandidates } from './locate'

describe('mpvCandidates', () => {
  it('prefers user path, then bundled, then common installs and PATH', () => {
    const list = mpvCandidates({
      userPath: 'D:\\tools\\mpv.exe',
      bundledPath: 'C:\\app\\resources\\mpv\\mpv.exe',
      programFiles: 'C:\\Program Files',
      localAppData: 'C:\\Users\\me\\AppData\\Local',
      pathEnv: 'C:\\bin;C:\\Program Files\\mpv'
    })
    expect(list[0]).toBe('D:\\tools\\mpv.exe')
    expect(list[1]).toBe('C:\\app\\resources\\mpv\\mpv.exe')
    expect(list).toContain('C:\\Program Files\\mpv\\mpv.exe')
    expect(list).toContain('C:\\bin\\mpv.exe')
  })
  it('dedupes repeated candidates', () => {
    const list = mpvCandidates({ programFiles: 'C:\\Program Files', pathEnv: 'C:\\Program Files\\mpv' })
    const count = list.filter((p) => p === 'C:\\Program Files\\mpv\\mpv.exe').length
    expect(count).toBe(1)
  })
  it('tolerates empty env', () => {
    expect(mpvCandidates({})).toEqual([])
  })
})
