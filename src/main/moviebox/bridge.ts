import net from 'node:net'
import type {
  MovieBoxBridgeEvent,
  MovieBoxBridgeSession,
  MovieBoxPlaybackReply,
  MovieBoxPlaybackSource,
  MovieBoxPlaybackState
} from '@shared/moviebox'
import { EMPTY_MOVIEBOX_STATE } from '@shared/moviebox'

const MAX_LINE_BYTES = 8 * 1024 * 1024
const POLL_MS = 100
const IDLE_POLL_MS = 250
const METADATA_MS = 2_000
const CONNECT_RETRY_MS = 250
const CONNECT_RETRY_LIMIT = 120

type Send = (event: MovieBoxBridgeEvent) => void

interface PendingAction {
  action: string
  id: string
  value: number
}

export interface MovieBoxLaunchArgs {
  pipeName: string
  userAgent: string | null
}

type LaunchEnvironment = Partial<Record<'LUMEN_MOVIEBOX_PIPE' | 'LUMEN_MOVIEBOX_USER_AGENT', string | undefined>>

function argValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index < 0 || index + 1 >= argv.length) return null
  const value = argv[index + 1]?.trim()
  return value || null
}

/** Only connect to a local named pipe; never accept a path or remote pipe host. */
function validatedLaunchArgs(pipeName: unknown, rawUserAgent: unknown): MovieBoxLaunchArgs | null {
  if (typeof pipeName !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(pipeName)) return null
  const userAgent = typeof rawUserAgent === 'string'
    ? rawUserAgent.replace(/[\r\n]/g, '').slice(0, 512) || null
    : null
  return { pipeName, userAgent }
}

export function movieBoxLaunchArgs(argv: string[], env: LaunchEnvironment = {}): MovieBoxLaunchArgs | null {
  return validatedLaunchArgs(
    argValue(argv, '--bridge') ?? env.LUMEN_MOVIEBOX_PIPE,
    argValue(argv, '--user-agent') ?? env.LUMEN_MOVIEBOX_USER_AGENT
  )
}

export function movieBoxLaunchData(value: unknown): MovieBoxLaunchArgs | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { pipeName?: unknown; userAgent?: unknown }
  return validatedLaunchArgs(candidate.pipeName, candidate.userAgent)
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeMovieBoxState(value: MovieBoxPlaybackState): MovieBoxPlaybackState {
  return {
    revision: Math.max(0, Math.trunc(finite(value.revision))),
    position: Math.max(0, finite(value.position)),
    duration: Math.max(0, finite(value.duration)),
    playing: !!value.playing,
    ready: !!value.ready,
    volume: Math.max(0, Math.min(100, Math.round(finite(value.volume, 100)))),
    muted: !!value.muted
  }
}

export class MovieBoxBridgeClient {
  private socket: net.Socket | null = null
  private socketConnected = false
  private buffer = ''
  private timer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private connectionGeneration = 0
  private inFlight = false
  private state: MovieBoxPlaybackState = { ...EMPTY_MOVIEBOX_STATE }
  private actions: PendingAction[] = []
  private lastMetadataAt = 0
  private lastReply: MovieBoxPlaybackReply | null = null
  private activeSource: MovieBoxPlaybackSource | null = null
  private lastError: string | null = null
  private activePipe: string | null = null
  private activeUserAgent: string | null = null

  constructor(private readonly send: Send) {}

  session(): MovieBoxBridgeSession {
    const reply = this.lastReply
      ? { ...this.lastReply, Source: this.lastReply.Source ?? this.activeSource }
      : this.activeSource ? { Source: this.activeSource } : null
    return { connected: this.socketConnected, reply, error: this.lastError }
  }

  userAgentFor(url: string): string | undefined {
    return this.activeSource?.Uri === url ? this.activeUserAgent ?? undefined : undefined
  }

  connect(args: MovieBoxLaunchArgs): void {
    if (this.activePipe === args.pipeName &&
      ((this.socket && !this.socket.destroyed) || this.reconnectTimer)) return
    this.stop(false)
    this.activePipe = args.pipeName
    this.activeUserAgent = args.userAgent
    this.lastReply = null
    this.activeSource = null
    this.lastError = null
    this.state = { ...EMPTY_MOVIEBOX_STATE }

    this.openSocket(args, this.connectionGeneration, 0)
  }

  private openSocket(args: MovieBoxLaunchArgs, generation: number, attempt: number): void {
    if (generation !== this.connectionGeneration || this.activePipe !== args.pipeName) return

    const socket = net.connect(`\\\\.\\pipe\\${args.pipeName}`)
    let connected = false
    this.socket = socket
    socket.setNoDelay(true)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      if (this.socket !== socket || generation !== this.connectionGeneration) return
      connected = true
      this.socketConnected = true
      this.lastError = null
      this.send({ type: 'connected' })
      this.pollNow()
    })
    socket.on('data', (chunk: string) => this.onData(socket, chunk))
    socket.on('error', (error) => {
      if (this.socket !== socket) return
      this.lastError = error.message
    })
    socket.on('close', () => {
      if (this.socket !== socket || generation !== this.connectionGeneration) return
      this.clearTimer()
      this.socket = null
      this.socketConnected = false
      this.inFlight = false
      if (!connected && attempt < CONNECT_RETRY_LIMIT && this.activePipe === args.pipeName) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.openSocket(args, generation, attempt + 1)
        }, CONNECT_RETRY_MS)
        return
      }
      this.send({ type: 'disconnected', reason: this.lastError ?? undefined })
    })
  }

  updateState(state: MovieBoxPlaybackState): void {
    this.state = normalizeMovieBoxState(state)
  }

  queueAction(action: string, id = '', value = 0): void {
    const cleanAction = action.trim().slice(0, 64)
    if (!cleanAction) return
    this.actions.push({ action: cleanAction, id: id.slice(0, 512), value: finite(value) })
    this.pollNow()
  }

  stop(sendClose = true): void {
    this.connectionGeneration++
    const socket = this.socket
    if (socket && !socket.destroyed && sendClose) {
      try {
        socket.write(`${JSON.stringify(this.request({ action: 'close', id: '', value: 0 }))}\n`)
      } catch {
        // Best-effort shutdown; destroying the pipe still makes the hook close.
      }
    }
    this.clearTimer()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket = null
    this.socketConnected = false
    this.inFlight = false
    this.buffer = ''
    socket?.destroy()
  }

  private onData(socket: net.Socket, chunk: string): void {
    if (this.socket !== socket) return
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
      this.lastError = 'MovieBox bridge reply exceeded 8 MiB.'
      this.stop(false)
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.onLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private onLine(line: string): void {
    this.inFlight = false
    try {
      const reply = JSON.parse(line) as MovieBoxPlaybackReply
      this.lastReply = reply
      if (reply.Source && Number.isFinite(reply.Source.Revision)) {
        this.activeSource = reply.Source
        const sourceUserAgent = typeof reply.Source.UserAgent === 'string'
          ? reply.Source.UserAgent.replace(/[\r\n]/g, '').slice(0, 512)
          : ''
        if (sourceUserAgent) this.activeUserAgent = sourceUserAgent
        this.state.revision = Math.max(0, Math.trunc(reply.Source.Revision))
      }
      if (typeof reply.Error === 'string' && reply.Error) this.lastError = reply.Error
      this.send({ type: 'reply', reply })
      if (reply.Closed) {
        this.activeSource = null
        this.stop(false)
        return
      }
    } catch (error) {
      this.lastError = `Invalid MovieBox bridge reply: ${error instanceof Error ? error.message : String(error)}`
      this.stop(false)
      return
    }
    this.schedulePoll()
  }

  private request(action: PendingAction): Record<string, unknown> {
    const now = Date.now()
    const metadata = now - this.lastMetadataAt >= METADATA_MS
    if (metadata) this.lastMetadataAt = now
    return {
      Action: action.action,
      Revision: this.state.revision,
      Position: this.state.position,
      Duration: this.state.duration,
      Playing: this.state.playing,
      Ready: this.state.ready,
      Volume: this.state.volume,
      Muted: this.state.muted,
      Metadata: metadata,
      Id: action.id,
      Value: action.value
    }
  }

  private pollNow(): void {
    this.clearTimer()
    const socket = this.socket
    if (!socket || socket.destroyed || !socket.writable || this.inFlight) return
    const action = this.actions.shift() ?? { action: 'poll', id: '', value: 0 }
    this.inFlight = true
    try {
      socket.write(`${JSON.stringify(this.request(action))}\n`)
    } catch (error) {
      this.inFlight = false
      this.lastError = error instanceof Error ? error.message : String(error)
      this.stop(false)
    }
  }

  private schedulePoll(): void {
    this.clearTimer()
    this.timer = setTimeout(
      () => this.pollNow(),
      this.actions.length ? 0 : this.activeSource ? POLL_MS : IDLE_POLL_MS
    )
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
