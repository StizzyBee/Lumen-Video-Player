import { WebSocket } from 'ws'
import {
  WATCH_INVITE_PROTOCOL,
  type InviteClientMessage,
  type InviteEvent,
  type InviteServerMessage,
  type WatchInviteMode
} from '@shared/together/invites'

const HEARTBEAT_MS = 15_000
const RECONNECT_MIN_MS = 800
const RECONNECT_MAX_MS = 12_000

export interface InviteConnectOptions {
  url: string
  memberId: string
  name: string
}

/** A second, tiny socket that remains online when no watch room is open. */
export class InviteClient {
  private socket: WebSocket | null = null
  private opts: InviteConnectOptions | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private attempts = 0
  private closing = false

  constructor(private readonly emit: (event: InviteEvent) => void) {}

  configure(opts: InviteConnectOptions): void {
    const next = `${opts.url}\n${opts.memberId}\n${opts.name}`
    const current = this.opts ? `${this.opts.url}\n${this.opts.memberId}\n${this.opts.name}` : ''
    if (next === current && this.socket) return
    this.disconnect(false)
    this.opts = opts
    this.closing = false
    this.attempts = 0
    this.open()
  }

  sendInvite(opts: {
    toId: string
    invite: string
    roomId: string
    title: string
    mode: WatchInviteMode
  }): void {
    this.send({ t: 'invite:send', ...opts })
  }

  respond(inviteId: string, accept: boolean): void {
    this.send({ t: 'invite:respond', inviteId, accept })
  }

  disconnect(notify = true): void {
    this.closing = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.reconnectTimer = null
    this.heartbeatTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      try { socket.close() } catch { /* already gone */ }
    }
    this.opts = null
    if (notify) this.emit({ type: 'status', status: 'disabled' })
  }

  private open(): void {
    if (!this.opts || this.closing) return
    this.emit({ type: 'status', status: this.attempts ? 'reconnecting' : 'connecting' })
    let socket: WebSocket
    try {
      socket = new WebSocket(this.opts.url)
    } catch (error) {
      this.emit({ type: 'status', status: 'error', message: error instanceof Error ? error.message : String(error) })
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.on('open', () => {
      const opts = this.opts
      if (!opts || socket !== this.socket) return
      this.send({
        t: 'invite:register',
        protocol: WATCH_INVITE_PROTOCOL,
        memberId: opts.memberId,
        name: opts.name
      })
      this.startHeartbeat()
    })
    socket.on('message', (raw) => {
      let message: InviteServerMessage
      try { message = JSON.parse(String(raw)) as InviteServerMessage } catch { return }
      switch (message.t) {
        case 'invite:ready':
          this.attempts = 0
          this.emit({ type: 'status', status: 'online', lumenId: message.lumenId })
          break
        case 'invite:incoming':
          this.emit({ type: 'incoming', invite: message.invite })
          break
        case 'invite:delivery':
          this.emit({
            type: 'delivery',
            inviteId: message.inviteId,
            toId: message.toId,
            state: message.state
          })
          break
        case 'invite:error':
          this.emit({ type: 'error', message: message.message })
          break
        case 'invite:pong':
          break
      }
    })
    socket.on('close', () => {
      if (socket !== this.socket) return
      this.socket = null
      this.stopHeartbeat()
      if (!this.closing) this.scheduleReconnect()
    })
    socket.on('error', () => {
      // `close` owns retry and user-visible state. Reporting both produces two
      // warnings for one failed dial.
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.send({ t: 'invite:heartbeat' }), HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private scheduleReconnect(): void {
    if (this.closing || !this.opts || this.reconnectTimer) return
    this.attempts++
    this.emit({ type: 'status', status: 'reconnecting' })
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** (this.attempts - 1))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay * (0.8 + Math.random() * 0.4))
  }

  private send(message: InviteClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    try { this.socket.send(JSON.stringify(message)) } catch { /* close retries */ }
  }
}
