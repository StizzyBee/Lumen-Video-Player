// The relay client, and the machine's clock discipline.
//
// This lives in main rather than the renderer for two reasons. It matches
// Lumen's rule that privileged I/O never happens in the renderer, and it keeps
// the clock estimate off the main thread's render loop: a ping timed on a
// thread that is busy compositing a 4K frame reads high and skews the offset.

import { WebSocket } from 'ws'
import { ClockSync, sampleFrom } from '@shared/together/clock'
import type { TogetherEvent } from '@shared/together/api'
import {
  TOGETHER_PROTOCOL,
  type ClientMessage,
  type ContentRef,
  type ServerMessage
} from '@shared/together/protocol'

/** Fast pings while we settle, slow ones once the estimate is trustworthy. */
const PING_FAST_MS = 1200
const PING_SLOW_MS = 8000
const SETTLE_PINGS = 6

const RECONNECT_MIN_MS = 700
const RECONNECT_MAX_MS = 8000

export interface ConnectOptions {
  url: string
  roomId: string
  memberId: string
  name: string
  content: ContentRef | null
}

export class TogetherClient {
  private socket: WebSocket | null = null
  private clock = new ClockSync()
  private pingTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private attempts = 0
  private pingSeq = 1
  private inflight = new Map<number, number>()
  private opts: ConnectOptions | null = null
  private closing = false
  private emit: (e: TogetherEvent) => void
  private lastContent: ContentRef | null = null

  constructor(emit: (e: TogetherEvent) => void) {
    this.emit = emit
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
  get clockOffsetMs(): number {
    return this.clock.offsetMs
  }
  get rttMs(): number {
    return this.clock.rttMs
  }

  connect(opts: ConnectOptions): void {
    this.disconnect(false)
    this.opts = opts
    this.lastContent = opts.content
    this.closing = false
    this.attempts = 0
    this.open()
  }

  private open(): void {
    const opts = this.opts
    if (!opts) return
    this.emit({ type: 'status', status: this.attempts === 0 ? 'connecting' : 'reconnecting' })

    let socket: WebSocket
    try {
      socket = new WebSocket(opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.on('open', () => {
      // The clock estimate belongs to this connection. A reconnect may land on
      // a different relay entirely, so carrying the old offset over would put
      // us confidently on the wrong timeline.
      this.clock.reset()
      this.inflight.clear()
      this.send({
        t: 'hello',
        protocol: TOGETHER_PROTOCOL,
        roomId: opts.roomId,
        memberId: opts.memberId,
        name: opts.name,
        content: this.lastContent
      })
      this.startPinging()
    })

    socket.on('message', (raw) => {
      const receivedTs = Date.now()
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(raw)) as ServerMessage
      } catch {
        return
      }
      this.onMessage(msg, receivedTs)
    })

    socket.on('close', () => {
      this.stopPinging()
      if (this.closing) return
      this.scheduleReconnect()
    })

    socket.on('error', (err) => {
      if (this.closing) return
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  }

  private onMessage(msg: ServerMessage, receivedTs: number): void {
    switch (msg.t) {
      case 'pong': {
        const sentAt = this.inflight.get(msg.id)
        this.inflight.delete(msg.id)
        if (sentAt === undefined) return
        this.clock.add(sampleFrom(sentAt, msg.serverTs, receivedTs))
        this.emit({
          type: 'clock',
          clockOffsetMs: this.clock.offsetMs,
          rttMs: this.clock.rttMs,
          settled: this.clock.settled
        })
        break
      }
      case 'welcome':
        // A socket being open only proves that a server answered. The room has
        // accepted our invite only once Welcome arrives.
        this.attempts = 0
        this.emit({ type: 'status', status: 'connected' })
        this.emit({
          type: 'room',
          room: msg.room,
          clockOffsetMs: this.clock.offsetMs,
          rttMs: this.clock.rttMs,
          settled: this.clock.settled
        })
        break
      case 'room':
        this.emit({
          type: 'room',
          room: msg.room,
          clockOffsetMs: this.clock.offsetMs,
          rttMs: this.clock.rttMs,
          settled: this.clock.settled
        })
        break
      case 'denied':
        this.emit({
          type: 'denied',
          action: msg.action,
          reason: msg.reason,
          until: msg.until,
          message: msg.message
        })
        break
      case 'notice':
        this.emit({ type: 'notice', level: msg.level, title: msg.title, desc: msg.desc })
        break
      case 'error':
        this.emit({ type: 'error', message: msg.message })
        // A protocol or room error will not fix itself by trying again.
        if (msg.code === 'bad-protocol' || msg.code === 'bad-room' || msg.code === 'room-full') {
          this.disconnect(true)
          this.emit({ type: 'status', status: 'error' })
        }
        break
    }
  }

  private startPinging(): void {
    this.stopPinging()
    let sent = 0
    const ping = (): void => {
      if (!this.connected) return
      const id = this.pingSeq++
      const now = Date.now()
      this.inflight.set(id, now)
      // A pong that never came is not evidence about the clock; drop it so a
      // stale entry cannot later be matched against a much newer reply.
      for (const [key, ts] of this.inflight) {
        if (now - ts > 10_000) this.inflight.delete(key)
      }
      this.send({ t: 'ping', id, clientTs: now })
      sent++
      // Burst on arrival to lock the clock quickly, then back off — a settled
      // estimate needs maintenance, not a constant stream of traffic.
      const next = sent < SETTLE_PINGS || !this.clock.settled ? PING_FAST_MS : PING_SLOW_MS
      this.pingTimer = setTimeout(ping, next)
    }
    ping()
  }

  private stopPinging(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer)
    this.pingTimer = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing || !this.opts) return
    this.attempts++
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** (this.attempts - 1))
    // Jitter so a relay restart does not bring every watcher back at once.
    const wait = delay * (0.75 + Math.random() * 0.5)
    this.emit({ type: 'status', status: 'reconnecting' })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, wait)
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  intent(kind: 'play' | 'pause' | 'seek' | 'rate', mediaTime: number, rate?: number): void {
    this.send({ t: 'intent', kind, mediaTime, rate })
  }

  report(data: { ready: boolean; bufferedAhead: number; mediaTime: number; driftMs: number }): void {
    this.send({ t: 'report', ...data, rttMs: Math.round(this.clock.rttMs) })
  }

  setContent(content: ContentRef): void {
    this.lastContent = content
    this.send({ t: 'content', content })
  }

  callVote(kind: 'resume' | 'revoke', targetId?: string, durationMs?: number): void {
    this.send({ t: 'callVote', kind, targetId, durationMs })
  }

  vote(ballotId: string, choice: 'yes' | 'no'): void {
    this.send({ t: 'vote', ballotId, choice })
  }

  disconnect(sayGoodbye = true): void {
    this.closing = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopPinging()
    if (this.socket) {
      if (sayGoodbye && this.connected) this.send({ t: 'bye' })
      const socket = this.socket
      this.socket = null
      try {
        socket.close()
      } catch {
        /* already gone */
      }
    }
    this.clock.reset()
    this.inflight.clear()
    if (sayGoodbye) {
      this.opts = null
      this.emit({ type: 'status', status: 'idle' })
    }
  }

  private send(msg: ClientMessage): void {
    if (!this.connected) return
    try {
      this.socket?.send(JSON.stringify(msg))
    } catch {
      /* the close handler will reconnect */
    }
  }
}
