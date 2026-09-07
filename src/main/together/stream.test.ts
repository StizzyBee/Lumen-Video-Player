import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeSource, parseRange } from './stream'
import { TogetherRelay } from './relay'
import { streamUrlFrom } from '@shared/together/protocol'

const TOTAL = 1000

describe('range parsing', () => {
  it('reads an ordinary range', () => {
    expect(parseRange('bytes=0-499', TOTAL)).toEqual({ start: 0, end: 499 })
    expect(parseRange('bytes=500-999', TOTAL)).toEqual({ start: 500, end: 999 })
  })

  it('treats an open end as "to the end of the file"', () => {
    // What a browser sends when it starts playing.
    expect(parseRange('bytes=0-', TOTAL)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=900-', TOTAL)).toEqual({ start: 900, end: 999 })
  })

  it('handles a suffix range', () => {
    // Players read the tail of a file to find the index in some containers.
    expect(parseRange('bytes=-200', TOTAL)).toEqual({ start: 800, end: 999 })
    // A suffix larger than the file is the whole file, not a negative offset.
    expect(parseRange('bytes=-5000', TOTAL)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the file rather than over-reading', () => {
    expect(parseRange('bytes=0-99999', TOTAL)).toEqual({ start: 0, end: 999 })
  })

  it('rejects ranges that cannot be satisfied', () => {
    // These must produce a 416, never a read outside the file.
    expect(parseRange('bytes=1000-1100', TOTAL)).toBe('invalid')
    expect(parseRange('bytes=600-500', TOTAL)).toBe('invalid')
    expect(parseRange('bytes=-0', TOTAL)).toBe('invalid')
    expect(parseRange('bytes=-', TOTAL)).toBe('invalid')
  })

  it('ignores headers it does not understand instead of guessing', () => {
    expect(parseRange(undefined, TOTAL)).toBeNull()
    expect(parseRange('items=0-10', TOTAL)).toBeNull()
    expect(parseRange('bytes=abc-def', TOTAL)).toBeNull()
    // Multipart ranges are legal HTTP but we do not serve them; falling back
    // to the whole file is correct, and never a partial read of the wrong part.
    expect(parseRange('bytes=0-99,200-299', TOTAL)).toBeNull()
  })
})

describe('deriving the media URL', () => {
  it('follows the address the guest actually reached the room on', () => {
    // The host sees itself as 127.0.0.1 and a friend reaches it over a VPN, so
    // only the guest knows which address works. Advertising one would break
    // every room that crosses a network boundary.
    expect(streamUrlFrom('ws://100.64.5.9:7345', 'a'.repeat(32))).toBe(
      `http://100.64.5.9:7345/stream/${'a'.repeat(32)}`
    )
  })

  it('keeps TLS when the relay is secured', () => {
    expect(streamUrlFrom('wss://relay.example.com', 'b'.repeat(32))).toBe(
      `https://relay.example.com/stream/${'b'.repeat(32)}`
    )
  })

  it('does not double up slashes', () => {
    expect(streamUrlFrom('ws://host:7345/', 'c'.repeat(32))).toBe(
      `http://host:7345/stream/${'c'.repeat(32)}`
    )
  })
})

// ── Served for real, over a live relay ──────────────────────────────────────

let relay: TogetherRelay | null = null
let dir: string | null = null

afterEach(() => {
  relay?.stop()
  relay = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('serving a film to the room', () => {
  it('streams the host file, honours Range, and refuses unknown tokens', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lumen-stream-'))
    const file = join(dir, 'film.mp4')
    // Deterministic bytes so a partial read can be checked exactly.
    const body = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))
    writeFileSync(file, body)

    relay = new TogetherRelay({ port: 0, host: '127.0.0.1', seedRoom: 'STRM23' })
    const started = await relay.start()
    const source = await describeSource(file)
    relay.setStreamSource(source, started.roomId)

    const base = `http://127.0.0.1:${started.port}/stream/${source.token}`

    // Whole file.
    const whole = await fetch(base)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await whole.arrayBuffer()).equals(body)).toBe(true)

    // A byte range, which is how a player seeks.
    const part = await fetch(base, { headers: { Range: 'bytes=1000-1099' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 1000-1099/5000')
    expect(Buffer.from(await part.arrayBuffer()).equals(body.subarray(1000, 1100))).toBe(true)

    // An unsatisfiable range must be refused, never clamped into a bad read.
    const bad = await fetch(base, { headers: { Range: 'bytes=99999-' } })
    expect(bad.status).toBe(416)

    // Guessing a token gets you nothing — it is the only key to the file.
    const wrong = await fetch(`http://127.0.0.1:${started.port}/stream/${'0'.repeat(32)}`)
    expect(wrong.status).toBe(404)

    // And nothing else on disk is addressable through the relay at all.
    const traversal = await fetch(`http://127.0.0.1:${started.port}/stream/../../etc/hosts`)
    expect(traversal.status).toBe(404)
  }, 15_000)

  it('stops serving the moment the host stops sharing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lumen-stream-'))
    const file = join(dir, 'film.mp4')
    writeFileSync(file, Buffer.alloc(64, 7))

    relay = new TogetherRelay({ port: 0, host: '127.0.0.1', seedRoom: 'STRM24' })
    const started = await relay.start()
    const source = await describeSource(file)
    relay.setStreamSource(source, started.roomId)
    const url = `http://127.0.0.1:${started.port}/stream/${source.token}`
    expect((await fetch(url)).status).toBe(200)

    relay.setStreamSource(null, started.roomId)
    // A link already shared must go dead rather than outliving the room.
    expect((await fetch(url)).status).toBe(404)
  }, 15_000)

  it('flags a container guests cannot decode', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lumen-stream-'))
    const mkv = join(dir, 'film.mkv')
    writeFileSync(mkv, Buffer.alloc(16))
    // The host plays this happily through mpv; guests get a blank screen, so
    // the offer has to carry the warning rather than failing silently.
    expect((await describeSource(mkv)).guestPlayable).toBe(false)

    const mp4 = join(dir, 'film.mp4')
    writeFileSync(mp4, Buffer.alloc(16))
    expect((await describeSource(mp4)).guestPlayable).toBe(true)
  })
})
