import { afterEach, describe, expect, it } from 'vitest'
import type { InviteEvent } from '@shared/together/invites'
import { InviteClient } from './invite-client'
import { TogetherRelay } from './relay'

let relay: TogetherRelay | null = null
const clients: InviteClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect(false)
  relay?.stop()
  relay = null
})

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for invitation event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function setup(): Promise<{ url: string; port: number }> {
  relay = new TogetherRelay({ port: 0, host: '127.0.0.1' })
  const started = await relay.start()
  return { url: `ws://127.0.0.1:${started.port}`, port: started.port }
}

function player(url: string, memberId: string, name: string): { client: InviteClient; events: InviteEvent[] } {
  const events: InviteEvent[] = []
  const client = new InviteClient((event) => events.push(event))
  clients.push(client)
  client.configure({ url, memberId, name })
  return { client, events }
}

describe('player invitations', () => {
  it('rings an online player and returns their acceptance', async () => {
    const { url, port } = await setup()
    const ana = player(url, 'm-ab12cd34ef56', 'Ana')
    await until(() => ana.events.some((event) => event.type === 'status' && event.status === 'online'))
    const ben = player(url, 'm-zz98yy76xx54', 'Ben')
    await until(() => ben.events.some((event) => event.type === 'status' && event.status === 'online'))

    ana.client.sendInvite({
      toId: 'LMN-2',
      invite: `127.0.0.1:${port}#TEST23`,
      roomId: 'TEST23',
      title: 'The Film',
      mode: 'stream'
    })
    await until(() => ben.events.some((event) => event.type === 'incoming'))
    const incoming = ben.events.find((event) => event.type === 'incoming')
    expect(incoming).toMatchObject({
      type: 'incoming',
      invite: { fromName: 'Ana', title: 'The Film', mode: 'stream' }
    })
    if (incoming?.type !== 'incoming') throw new Error('missing incoming invitation')
    ben.client.respond(incoming.invite.id, true)

    await until(() => ana.events.some((event) => event.type === 'delivery' && event.state === 'accepted'))
  })

  it('reports an unknown player as offline', async () => {
    const { url, port } = await setup()
    const ana = player(url, 'm-ab12cd34ef56', 'Ana')
    await until(() => ana.events.some((event) => event.type === 'status' && event.status === 'online'))
    ana.client.sendInvite({
      toId: 'LMN-999',
      invite: `127.0.0.1:${port}#TEST23`,
      roomId: 'TEST23',
      title: 'The Film',
      mode: 'library'
    })
    await until(() => ana.events.some((event) => event.type === 'delivery' && event.state === 'offline'))
  })
})
