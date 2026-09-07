// The relay: a WebSocket server wrapping the pure room state machine.
//
// Lumen can host this itself, so two friends need no infrastructure at all —
// one of them starts a room and the other connects to their address. The same
// file also runs standalone (see server/) for anyone who would rather put a
// small always-on box in the middle than open a port at home.

import { createServer, type Server as HttpServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { serveStream, type StreamSource } from './stream'
import {
  WATCH_INVITE_PROTOCOL,
  WATCH_INVITE_TTL_MS,
  lumenIdFromMemberId,
  normalizeLumenId,
  type InviteClientMessage,
  type InviteServerMessage,
  type WatchInvite
} from '@shared/together/invites'
import { parseInvite } from '@shared/together/mesh'
import {
  MEMBER_TIMEOUT_MS,
  REJOIN_GRACE_MS,
  ROOM_CODE_RE,
  TOGETHER_PROTOCOL,
  makeRoomCode,
  type ClientMessage,
  type ServerMessage
} from '@shared/together/protocol'
import {
  callVote,
  castVote,
  createRoom,
  disconnect,
  intent,
  join,
  remove,
  report,
  setContent,
  setStream,
  snapshot,
  tick,
  type Effect,
  type RoomState
} from '@shared/together/room'

interface Connection {
  socket: WebSocket
  roomId: string
  memberId: string
  lastSeen: number
}

interface InviteConnection {
  socket: WebSocket
  memberId: string
  lumenId: string
  name: string
  lastSeen: number
}

interface PendingInvite {
  invite: WatchInvite
  from: InviteConnection
  to: InviteConnection
}

export interface RelayOptions {
  port: number
  host?: string
  /** Pre-create this room code (the host's own room). */
  seedRoom?: string
  /** Rooms are created on demand when false — used by the standalone relay. */
  fixedRooms?: boolean
  /** Shown to guests in a streaming room. */
  streamTitle?: string
  streamDurationSec?: number
}

export class TogetherRelay {
  private wss: WebSocketServer | null = null
  private http: HttpServer | null = null
  /** The one file this relay will serve, in a streaming room. */
  private source: StreamSource | null = null
  private rooms = new Map<string, RoomState>()
  private connections = new Map<WebSocket, Connection>()
  private inviteConnections = new Map<WebSocket, InviteConnection>()
  private inviteDirectory = new Map<string, InviteConnection>()
  private pendingInvites = new Map<string, PendingInvite>()
  private pending = new Map<string, NodeJS.Timeout>()
  private timer: NodeJS.Timeout | null = null
  private opts: RelayOptions

  constructor(opts: RelayOptions) {
    this.opts = opts
  }

  get port(): number {
    const addr = this.http?.address()
    return typeof addr === 'object' && addr ? addr.port : this.opts.port
  }

  /**
   * Offer a file to the room. Serving it from the relay's own port means
   * guests need nothing beyond the address they already connected to.
   */
  setStreamSource(source: StreamSource | null, roomId: string): void {
    this.source = source
    const room = this.rooms.get(roomId)
    if (!room) return
    setStream(
      room,
      source
        ? {
            token: source.token,
            title: this.opts.streamTitle ?? 'Shared video',
            durationSec: this.opts.streamDurationSec ?? 0,
            ext: source.ext,
            guestPlayable: source.guestPlayable
          }
        : null
    )
    this.broadcast(roomId, { t: 'room', room: snapshot(room, Date.now()) })
  }

  async start(): Promise<{ port: number; roomId: string }> {
    const roomId = this.opts.seedRoom ?? makeRoomCode()
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, createRoom(roomId, Date.now()))

    await new Promise<void>((resolve, reject) => {
      // One port for both jobs: the socket carries the timeline, and the same
      // listener serves the film in a streaming room. A guest that can reach
      // the room can therefore always reach the video.
      const http = createServer((req, res) => {
        const url = req.url ?? '/'
        const match = /^\/stream\/([0-9a-f]{32})(?:$|\?)/.exec(url)
        if (!match) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('lumen together relay')
          return
        }
        // Compare against the live token so a stale link stops working the
        // moment the host stops sharing.
        serveStream(req, res, this.source && this.source.token === match[1] ? this.source : null)
      })
      this.http = http

      // Every valid control/invitation message is tiny. Cap frames so a public
      // relay cannot be used as a memory sink by an unauthenticated client.
      const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 })
      this.wss = wss
      wss.on('error', (err) => console.error('[together] relay error', err))
      wss.on('connection', (socket) => this.onConnection(socket))

      http.once('error', reject)
      http.once('listening', () => {
        http.off('error', reject)
        http.on('error', (err) => console.error('[together] relay error', err))
        resolve()
      })
      http.listen(this.opts.port, this.opts.host)
    })

    // Housekeeping: expire ballots and restrictions, evict silent members.
    this.timer = setInterval(() => this.sweep(), 1000)
    return { port: this.port, roomId }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
    for (const socket of this.connections.keys()) {
      try {
        socket.close(1001, 'relay stopping')
      } catch {
        /* already gone */
      }
    }
    this.connections.clear()
    for (const socket of this.inviteConnections.keys()) {
      try { socket.close(1001, 'relay stopping') } catch { /* already gone */ }
    }
    this.inviteConnections.clear()
    this.inviteDirectory.clear()
    this.pendingInvites.clear()
    this.wss?.close()
    this.wss = null
    this.http?.close()
    this.http = null
    this.source = null
  }

  private onConnection(socket: WebSocket): void {
    socket.on('message', (raw) => {
      let msg: ClientMessage | InviteClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage | InviteClientMessage
      } catch {
        this.send(socket, { t: 'error', code: 'malformed', message: 'Could not read that message.' })
        return
      }
      try {
        if (typeof msg.t === 'string' && msg.t.startsWith('invite:')) this.handleInvite(socket, msg as InviteClientMessage)
        else this.handle(socket, msg as ClientMessage)
      } catch (err) {
        console.error('[together] handler failed', err)
      }
    })
    socket.on('close', () => this.onClose(socket))
    socket.on('error', () => this.onClose(socket))
  }

  private handleInvite(socket: WebSocket, msg: InviteClientMessage): void {
    const now = Date.now()
    if (msg.t === 'invite:register') {
      if (msg.protocol !== WATCH_INVITE_PROTOCOL) {
        this.sendInvite(socket, { t: 'invite:error', message: 'Update Lumen to use player invitations.' })
        socket.close()
        return
      }
      const lumenId = lumenIdFromMemberId(String(msg.memberId ?? ''))
      const key = normalizeLumenId(lumenId)
      if (!key || key.length < 10 || key.length > 20) {
        this.sendInvite(socket, { t: 'invite:error', message: 'That Lumen ID is not valid.' })
        socket.close()
        return
      }

      const existing = this.inviteDirectory.get(key)
      if (existing && existing.socket !== socket) {
        this.removeInviteConnection(existing.socket)
        try { existing.socket.close(1000, 'replaced') } catch { /* already gone */ }
      }
      const conn: InviteConnection = {
        socket,
        memberId: msg.memberId,
        lumenId,
        name: String(msg.name || 'Watcher').slice(0, 24),
        lastSeen: now
      }
      this.inviteConnections.set(socket, conn)
      this.inviteDirectory.set(key, conn)
      this.sendInvite(socket, { t: 'invite:ready', lumenId })
      return
    }

    const sender = this.inviteConnections.get(socket)
    if (!sender) {
      this.sendInvite(socket, { t: 'invite:error', message: 'Register this Lumen player first.' })
      return
    }
    sender.lastSeen = now

    if (msg.t === 'invite:heartbeat') {
      this.sendInvite(socket, { t: 'invite:pong' })
      return
    }

    if (msg.t === 'invite:send') {
      const targetKey = normalizeLumenId(String(msg.toId ?? ''))
      const target = this.inviteDirectory.get(targetKey)
      if (!target || target.socket.readyState !== target.socket.OPEN) {
        this.sendInvite(socket, { t: 'invite:delivery', toId: msg.toId, state: 'offline' })
        return
      }
      if (target.socket === socket) {
        this.sendInvite(socket, { t: 'invite:error', message: "You can't invite this Lumen player to itself." })
        return
      }
      if ([...this.pendingInvites.values()].some((pending) => pending.to.socket === target.socket)) {
        this.sendInvite(socket, { t: 'invite:error', message: 'That Lumen player is already answering an invitation.' })
        return
      }
      const parsed = parseInvite(String(msg.invite ?? ''))
      if (!parsed || parsed.roomId !== String(msg.roomId ?? '').toUpperCase()) {
        this.sendInvite(socket, { t: 'invite:error', message: 'The watch-room invitation is not valid.' })
        return
      }
      const id = randomBytes(12).toString('hex')
      const invite: WatchInvite = {
        id,
        fromId: sender.lumenId,
        fromName: sender.name,
        invite: msg.invite.slice(0, 512),
        roomId: parsed.roomId,
        title: String(msg.title || 'a film').slice(0, 160),
        mode: msg.mode === 'stream' ? 'stream' : 'library',
        expiresAt: now + WATCH_INVITE_TTL_MS
      }
      this.pendingInvites.set(id, { invite, from: sender, to: target })
      this.sendInvite(target.socket, { t: 'invite:incoming', invite })
      this.sendInvite(socket, { t: 'invite:delivery', inviteId: id, toId: target.lumenId, state: 'ringing' })
      return
    }

    const pending = this.pendingInvites.get(msg.inviteId)
    if (!pending || pending.to.socket !== socket) return
    this.pendingInvites.delete(msg.inviteId)
    this.sendInvite(pending.from.socket, {
      t: 'invite:delivery',
      inviteId: msg.inviteId,
      toId: pending.to.lumenId,
      state: msg.accept ? 'accepted' : 'declined'
    })
  }

  private handle(socket: WebSocket, msg: ClientMessage): void {
    const now = Date.now()

    // The clock exchange must be answered before anything else and without
    // any of the bookkeeping below: every millisecond spent here lands
    // directly in the offset estimate as measurement error.
    if (msg.t === 'ping') {
      this.send(socket, { t: 'pong', id: msg.id, clientTs: msg.clientTs, serverTs: Date.now() })
      const known = this.connections.get(socket)
      if (known) known.lastSeen = now
      return
    }

    if (msg.t === 'hello') {
      this.onHello(socket, msg, now)
      return
    }

    const conn = this.connections.get(socket)
    if (!conn) {
      this.send(socket, { t: 'error', code: 'bad-room', message: 'Say hello first.' })
      return
    }
    conn.lastSeen = now
    const room = this.rooms.get(conn.roomId)
    if (!room) return

    let effect: Effect = { changed: false }
    switch (msg.t) {
      case 'intent':
        effect = intent(room, conn.memberId, msg.kind, msg.mediaTime, msg.rate, now)
        break
      case 'report':
        effect = report(
          room,
          conn.memberId,
          { ready: msg.ready, bufferedAhead: msg.bufferedAhead, driftMs: msg.driftMs, rttMs: msg.rttMs },
          now
        )
        break
      case 'content':
        effect = setContent(room, conn.memberId, msg.content)
        break
      case 'callVote':
        effect = callVote(room, conn.memberId, msg.kind, msg.targetId, msg.durationMs, now)
        break
      case 'vote':
        effect = castVote(room, conn.memberId, msg.ballotId, msg.choice, now)
        break
      case 'bye':
        effect = remove(room, conn.memberId, now)
        this.connections.delete(socket)
        this.clearPending(conn.roomId, conn.memberId)
        break
    }
    this.apply(room, effect, conn.memberId)
  }

  private onHello(socket: WebSocket, msg: Extract<ClientMessage, { t: 'hello' }>, now: number): void {
    if (msg.protocol !== TOGETHER_PROTOCOL) {
      this.send(socket, {
        t: 'error',
        code: 'bad-protocol',
        message: 'That watcher is running a different version of Lumen. Update both to watch together.'
      })
      socket.close()
      return
    }
    const roomId = (msg.roomId ?? '').toUpperCase()
    if (!ROOM_CODE_RE.test(roomId)) {
      this.send(socket, { t: 'error', code: 'bad-room', message: 'That room code is not valid.' })
      socket.close()
      return
    }

    let room = this.rooms.get(roomId)
    if (!room) {
      if (this.opts.fixedRooms) {
        this.send(socket, { t: 'error', code: 'bad-room', message: 'No room with that code is open.' })
        socket.close()
        return
      }
      room = createRoom(roomId, now)
      this.rooms.set(roomId, room)
    }

    const result = join(room, msg.memberId, msg.name || 'Watcher', msg.content, now)
    if (!result.ok) {
      this.send(socket, { t: 'error', code: 'room-full', message: 'That room is full.' })
      socket.close()
      return
    }

    // A second connection for the same member supersedes the first, so a
    // reconnect never leaves a ghost holding the ready-gate open.
    for (const [existingSocket, c] of this.connections) {
      if (c.memberId === msg.memberId && c.roomId === roomId && existingSocket !== socket) {
        this.connections.delete(existingSocket)
        try {
          existingSocket.close(1000, 'replaced')
        } catch {
          /* already gone */
        }
      }
    }

    this.connections.set(socket, { socket, roomId, memberId: msg.memberId, lastSeen: now })
    this.clearPending(roomId, msg.memberId)
    this.send(socket, { t: 'welcome', memberId: msg.memberId, room: snapshot(room, Date.now()) })
    this.apply(room, result.effect, msg.memberId)
  }

  private onClose(socket: WebSocket): void {
    this.removeInviteConnection(socket)
    const conn = this.connections.get(socket)
    if (!conn) return
    this.connections.delete(socket)
    const room = this.rooms.get(conn.roomId)
    if (!room) return

    this.apply(room, disconnect(room, conn.memberId, Date.now()), conn.memberId)

    // Hold their seat briefly. A flaky connection should not cost someone
    // their place — or let them shed a restriction by pulling the cable.
    const key = `${conn.roomId}/${conn.memberId}`
    this.clearPending(conn.roomId, conn.memberId)
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key)
        const r = this.rooms.get(conn.roomId)
        if (!r) return
        const member = r.members.get(conn.memberId)
        if (member?.connected) return
        this.apply(r, remove(r, conn.memberId, Date.now()), conn.memberId)
        if (r.members.size === 0 && !this.opts.seedRoom) this.rooms.delete(conn.roomId)
      }, REJOIN_GRACE_MS)
    )
  }

  private removeInviteConnection(socket: WebSocket): void {
    const conn = this.inviteConnections.get(socket)
    if (!conn) return
    this.inviteConnections.delete(socket)
    const key = normalizeLumenId(conn.lumenId)
    if (this.inviteDirectory.get(key)?.socket === socket) this.inviteDirectory.delete(key)
    for (const [id, pending] of this.pendingInvites) {
      if (pending.to.socket === socket) {
        this.pendingInvites.delete(id)
        this.sendInvite(pending.from.socket, {
          t: 'invite:delivery', inviteId: id, toId: pending.to.lumenId, state: 'missed'
        })
      } else if (pending.from.socket === socket) {
        this.pendingInvites.delete(id)
      }
    }
  }

  private clearPending(roomId: string, memberId: string): void {
    const key = `${roomId}/${memberId}`
    const timer = this.pending.get(key)
    if (timer) {
      clearTimeout(timer)
      this.pending.delete(key)
    }
  }

  private sweep(): void {
    const now = Date.now()
    for (const conn of this.connections.values()) {
      if (now - conn.lastSeen > MEMBER_TIMEOUT_MS) {
        try {
          conn.socket.close(1001, 'silent')
        } catch {
          /* already gone */
        }
      }
    }
    for (const conn of this.inviteConnections.values()) {
      if (now - conn.lastSeen > MEMBER_TIMEOUT_MS) {
        try { conn.socket.close(1001, 'silent') } catch { /* already gone */ }
      }
    }
    for (const [id, pending] of this.pendingInvites) {
      if (pending.invite.expiresAt <= now) {
        this.pendingInvites.delete(id)
        this.sendInvite(pending.from.socket, {
          t: 'invite:delivery', inviteId: id, toId: pending.to.lumenId, state: 'missed'
        })
      }
    }
    for (const room of this.rooms.values()) {
      const effect = tick(room, now)
      if (effect.changed || effect.notice) this.apply(room, effect, null)
    }
  }

  /** Deliver a state machine result: denial to one member, snapshot to all. */
  private apply(room: RoomState, effect: Effect, actorId: string | null): void {
    if (effect.deny) {
      const target = [...this.connections.values()].find(
        (c) => c.roomId === room.roomId && c.memberId === (effect.deny?.memberId ?? actorId)
      )
      if (target) {
        this.send(target.socket, {
          t: 'denied',
          action: effect.deny.action,
          reason: effect.deny.reason,
          until: effect.deny.until,
          message: effect.deny.message
        })
      }
    }
    if (effect.notice) {
      this.broadcast(room.roomId, { t: 'notice', ...effect.notice })
    }
    if (effect.changed) {
      // Always stamp the snapshot at send time. A snapshot built even a few
      // milliseconds earlier would hand every client a stale serverTs and
      // bias their clock offset by exactly that much.
      this.broadcast(room.roomId, { t: 'room', room: snapshot(room, Date.now()) })
    }
  }

  private broadcast(roomId: string, msg: ServerMessage): void {
    for (const conn of this.connections.values()) {
      if (conn.roomId === roomId) this.send(conn.socket, msg)
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      /* the close handler will clean up */
    }
  }

  private sendInvite(socket: WebSocket, msg: InviteServerMessage): void {
    if (socket.readyState !== socket.OPEN) return
    try { socket.send(JSON.stringify(msg)) } catch { /* close cleans up */ }
  }
}
