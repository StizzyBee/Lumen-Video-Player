// Together's slice of the IPC surface: host/join a room, relay intents, and
// stream room state back to the renderer.

import { ipcMain, shell, type BrowserWindow } from 'electron'
import { DEFAULT_PORT, makeRoomCode, type ContentRef } from '@shared/together/protocol'
import { MESH_PROVIDERS, type MeshProvider } from '@shared/together/mesh'
import { TogetherClient } from './client'
import { TogetherRelay } from './relay'
import { installMesh, joinZeroTier, meshStatus, scanAddresses } from './mesh'

export interface TogetherDeps {
  win: () => BrowserWindow
}

interface HostOptions {
  name: string
  memberId: string
  content: ContentRef | null
  port?: number
}

interface JoinOptions {
  url: string
  roomId: string
  name: string
  memberId: string
  content: ContentRef | null
}

export function registerTogetherIpc(deps: TogetherDeps): () => void {
  let relay: TogetherRelay | null = null

  const client = new TogetherClient((e) => {
    const win = deps.win()
    if (!win.isDestroyed()) win.webContents.send('together:event', e)
  })

  const stopRelay = (): void => {
    relay?.stop()
    relay = null
  }

  ipcMain.handle('together:host', async (_e, opts: HostOptions) => {
    stopRelay()
    client.disconnect(false)

    const roomId = makeRoomCode()
    const port = opts.port && opts.port > 0 ? opts.port : DEFAULT_PORT
    // Bind on every interface: the entire point of hosting is that somebody
    // else can reach it. Which of our addresses will actually work for them is
    // reported back, ranked, rather than assumed — see scanAddresses().
    relay = new TogetherRelay({ port, host: '0.0.0.0', seedRoom: roomId })
    const started = await relay.start()

    client.connect({
      // The host talks to its own relay over loopback, so its clock estimate
      // costs nothing and is near-exact. Everyone else measures against it.
      url: `ws://127.0.0.1:${started.port}`,
      roomId: started.roomId,
      memberId: opts.memberId,
      name: opts.name || 'Host',
      content: opts.content
    })

    return { roomId: started.roomId, port: started.port, addresses: scanAddresses() }
  })

  ipcMain.handle('together:join', async (_e, opts: JoinOptions) => {
    // Joining somebody else's room means we are not hosting one.
    stopRelay()
    client.connect({
      url: opts.url,
      roomId: opts.roomId.toUpperCase(),
      memberId: opts.memberId,
      name: opts.name || 'Watcher',
      content: opts.content
    })
  })

  ipcMain.on('together:leave', () => {
    client.disconnect(true)
    stopRelay()
  })

  ipcMain.on('together:intent', (_e, kind: 'play' | 'pause' | 'seek' | 'rate', mediaTime: number, rate?: number) => {
    client.intent(kind, mediaTime, rate)
  })

  ipcMain.on(
    'together:report',
    (_e, data: { ready: boolean; bufferedAhead: number; mediaTime: number; driftMs: number }) => {
      client.report(data)
    }
  )

  ipcMain.on('together:content', (_e, content: ContentRef) => client.setContent(content))

  ipcMain.on('together:call-vote', (_e, kind: 'resume' | 'revoke', targetId?: string, durationMs?: number) => {
    client.callVote(kind, targetId, durationMs)
  })

  ipcMain.on('together:vote', (_e, ballotId: string, choice: 'yes' | 'no') => {
    client.vote(ballotId, choice)
  })

  // ── mesh VPN (how a watch party crosses NAT) ──────────────────────────────
  ipcMain.handle('together:mesh-status', () => meshStatus())

  ipcMain.handle('together:mesh-install', async (_e, provider: 'zerotier' | 'tailscale') => {
    const win = deps.win()
    const result = await installMesh(provider, (line) => {
      if (!win.isDestroyed()) win.webContents.send('together:mesh-progress', line)
    })
    return result
  })

  ipcMain.handle('together:mesh-join', (_e, networkId: string) => joinZeroTier(networkId))

  ipcMain.on('together:mesh-setup', (_e, provider: MeshProvider) => {
    const entry = MESH_PROVIDERS[provider as keyof typeof MESH_PROVIDERS]
    if (entry) void shell.openExternal(entry.setupUrl)
  })

  // Never leave a relay listening or a socket open after Lumen exits.
  return () => {
    client.disconnect(false)
    stopRelay()
  }
}
