import { describe, expect, it } from 'vitest'
import { ytdlpCandidates, ffmpegCandidates } from './locate'

describe('ytdlpCandidates', () => {
  it('prefers user path, then WinGet links, then PATH', () => {
    const list = ytdlpCandidates({
      userPath: 'D:\\tools\\yt-dlp.exe',
      localAppData: 'C:\\Users\\me\\AppData\\Local',
      pathEnv: 'C:\\bin'
    })
    expect(list[0]).toBe('D:\\tools\\yt-dlp.exe')
    expect(list[1]).toBe('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe')
    expect(list).toContain('C:\\bin\\yt-dlp.exe')
  })
  it('dedupes and tolerates empty env', () => {
    expect(ytdlpCandidates({})).toEqual([])
    const list = ytdlpCandidates({
      localAppData: 'C:\\Users\\me\\AppData\\Local',
      pathEnv: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links'
    })
    expect(list.filter((p) => p.endsWith('Links\\yt-dlp.exe')).length).toBe(1)
  })
})

describe('ffmpegCandidates', () => {
  it('checks WinGet links and PATH', () => {
    const list = ffmpegCandidates({
      localAppData: 'C:\\Users\\me\\AppData\\Local',
      pathEnv: 'C:\\ff\\bin'
    })
    expect(list).toContain('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe')
    expect(list).toContain('C:\\ff\\bin\\ffmpeg.exe')
  })
})
