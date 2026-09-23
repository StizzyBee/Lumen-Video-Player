import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { MovieBoxBridgeClient, movieBoxLaunchArgs, movieBoxLaunchData, normalizeMovieBoxState } from './bridge'

describe('movieBoxLaunchArgs', () => {
  it('accepts a local pipe token and strips line breaks from the user agent', () => {
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', 'MovieBox-123_ab', '--user-agent', 'Agent\r\nInjected'])).toEqual({
      pipeName: 'MovieBox-123_ab',
      userAgent: 'AgentInjected'
    })
  })

  it('rejects paths and remote pipe names', () => {
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', '\\\\server\\pipe\\name'])).toBeNull()
    expect(movieBoxLaunchArgs(['Lumen.exe', '--bridge', '..\\name'])).toBeNull()
  })

  it('falls back to the scoped launch environment', () => {
    expect(movieBoxLaunchArgs(['Lumen.exe'], {
      LUMEN_MOVIEBOX_PIPE: 'MovieBox-env-123',
      LUMEN_MOVIEBOX_USER_AGENT: 'MovieBox\r\nAgent'
    })).toEqual({ pipeName: 'MovieBox-env-123', userAgent: 'MovieBoxAgent' })
  })

  it('validates single-instance launch data', () => {
    expect(movieBoxLaunchData({ pipeName: 'MovieBox-forwarded', userAgent: 'Agent' })).toEqual({
      pipeName: 'MovieBox-forwarded',
      userAgent: 'Agent'
    })
    expect(movieBoxLaunchData({ pipeName: '..\\remote', userAgent: null })).toBeNull()
  })
})

describe('normalizeMovieBoxState', () => {
  it('bounds numeric values sent to the bridge', () => {
    expect(normalizeMovieBoxState({
      revision: 2.9,
      position: -10,
      duration: Number.NaN,
      playing: true,
      ready: true,
      volume: 140,
      muted: false
    })).toEqual({
      revision: 2,
      position: 0,
      duration: 0,
      playing: true,
      ready: true,
      volume: 100,
      muted: false
    })
  })
})

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('MovieBoxBridgeClient pre-connect', () => {
  windowsIt('retries until a prewarmed MovieBox pipe becomes available', async () => {
    const pipeName = `LumenTest-${randomUUID().replaceAll('-', '')}`
    const pipePath = `\\\\.\\pipe\\${pipeName}`
    let resolveReply: (() => void) | null = null
    const reply = new Promise<void>((resolve) => { resolveReply = resolve })
    const client = new MovieBoxBridgeClient((event) => {
      if (event.type === 'reply') resolveReply?.()
    })
    client.connect({ pipeName, userAgent: null })

    await new Promise((resolve) => setTimeout(resolve, 350))
    const server = net.createServer((socket) => {
      socket.once('data', () => socket.write('{}\n'))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(pipePath, resolve)
    })

    try {
      await Promise.race([
        reply,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge retry timed out')), 3_000))
      ])
      expect(client.session().connected).toBe(true)
    } finally {
      client.stop(false)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
